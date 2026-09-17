// Netlify Function: nhận danh sách từ vựng, gọi Google Gemini API (MIỄN PHÍ,
// không cần thẻ tín dụng) để tự đặt câu ví dụ đúng ngữ pháp cho từng từ.
// API key đọc từ biến môi trường phía server, KHÔNG bao giờ lộ ra trình duyệt.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let words;
  try {
    const body = JSON.parse(event.body || '{}');
    words = body.words;
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body không hợp lệ' }) };
  }

  if (!Array.isArray(words) || words.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Thiếu danh sách từ (words)' }) };
  }
  words = words.slice(0, 30);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server chưa cấu hình GEMINI_API_KEY. Vào Site settings > Environment variables trên Netlify để thêm.' })
    };
  }

  const prompt = `Bạn là giáo viên tiếng Trung dạy người Việt mới bắt đầu (trình độ HSK1-HSK2).
Với MỖI từ tiếng Trung trong danh sách dưới đây, hãy đặt ĐÚNG 1 câu ví dụ tiếng Trung:
- Ngắn gọn, tự nhiên, đúng ngữ pháp.
- Trình độ HSK1-HSK2 (câu đơn giản, dễ hiểu).
- Có sử dụng từ đó trong câu.
- Nếu từ đó là tên ngành nghề/chuyên môn, hãy đặt câu kiểu giới thiệu nghề nghiệp (ví dụ: 他是..., 我想当..., ...很辛苦 v.v.), chọn kiểu câu phù hợp nhất với từ đó.

Chỉ trả về JSON THUẦN (không markdown, không giải thích, không có chữ nào khác ngoài JSON), đúng định dạng mảng sau:
[{"word":"tu_goc_1","sentence":"cau_vi_du_tieng_Trung_1"},{"word":"tu_goc_2","sentence":"cau_vi_du_tieng_Trung_2"}]

Danh sách từ cần đặt câu:
${words.join('\n')}`;

  try {
    const model = 'gemini-2.5-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await res.json();
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: data }) };
    }

    const text = (data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text) || '[]';
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    let sentences = [];
    try { sentences = JSON.parse(clean); } catch (e) { sentences = []; }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentences })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
