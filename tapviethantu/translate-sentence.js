// Netlify Function: dịch 1 câu (Việt hoặc Trung có xen tên riêng) bằng Gemini,
// trả về câu tiếng Trung hoàn chỉnh, nghĩa tiếng Việt cả câu, và tách sẵn
// thành từng CỤM TỪ có nghĩa (kèm pinyin + nghĩa) để khỏi phải tách bằng
// danh sách từ cứng ở phía trình duyệt.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let text;
  try {
    const body = JSON.parse(event.body || '{}');
    text = (body.text || '').trim();
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body không hợp lệ' }) };
  }
  if (!text) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Thiếu text' }) };
  }
  text = text.slice(0, 300);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server chưa cấu hình GEMINI_API_KEY.' })
    };
  }

  const prompt = `Bạn là trợ lý dịch Việt-Trung cho người học tiếng Hán sơ cấp.
Câu người dùng gõ vào có thể là: tiếng Việt thuần, tiếng Trung thuần, hoặc tiếng Trung xen tên riêng viết bằng chữ Latinh (ví dụ "Doris", "David").

Nhiệm vụ:
1. Nếu câu là tiếng Việt (hoặc có xen tên riêng Latinh): dịch toàn bộ sang tiếng Trung giản thể tự nhiên, đúng ngữ pháp. Tên riêng chữ Latinh thì phiên âm sang chữ Hán thông dụng hay dùng cho tên nước ngoài (ví dụ Doris → 多丽丝), đặt đúng vị trí ngữ pháp tự nhiên, thêm dấu phẩy nếu cần khi gọi tên ở đầu/cuối câu để đọc tự nhiên.
2. Nếu câu đã là tiếng Trung: giữ nguyên, không dịch lại, không đổi chữ nào.
3. Tách câu tiếng Trung kết quả thành từng CỤM TỪ CÓ NGHĨA — một cụm có thể gồm nhiều chữ nếu chúng tạo thành 1 từ/cụm cố định (kể cả tên riêng phiên âm, coi là 1 cụm duy nhất, không tách rời từng chữ). Dấu câu (，。！？) tách riêng, không gộp vào cụm chữ.
4. Với mỗi cụm chữ Hán (không tính dấu câu), cho pinyin có dấu thanh và nghĩa tiếng Việt ngắn gọn.
5. Dịch nghĩa cả câu sang tiếng Việt tự nhiên.

Chỉ trả về JSON THUẦN (không markdown, không giải thích gì thêm), đúng định dạng:
{"chinese":"câu tiếng Trung hoàn chỉnh","vietnamese":"nghĩa cả câu tiếng Việt","words":[{"text":"cụm 1","pinyin":"pinyin cụm 1","meaning":"nghĩa cụm 1"}]}

Câu cần xử lý: ${text}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta2/interactions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        model: 'gemini-3.8-flash',
        input: prompt
      })
    });

    const data = await res.json();
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: data }) };
    }

    const modelStep = (data.steps || []).find(s => s.type === 'model_output');
    const raw = (modelStep && modelStep.content && modelStep.content[0] && modelStep.content[0].text) || '{}';
    const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    let result;
    try { result = JSON.parse(clean); } catch (e) { result = null; }

    if (!result || !result.chinese) {
      return { statusCode: 502, body: JSON.stringify({ error: 'AI trả về dữ liệu không đọc được', raw: clean }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
