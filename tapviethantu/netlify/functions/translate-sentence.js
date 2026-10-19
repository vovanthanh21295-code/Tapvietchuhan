// Netlify Function: dịch 1 câu (Việt hoặc Trung có xen tên riêng) bằng Gemini,
// trả về câu tiếng Trung hoàn chỉnh, nghĩa tiếng Việt cả câu, và tách sẵn
// thành từng CỤM TỪ có nghĩa (kèm pinyin + nghĩa).

const MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'];

// Gọi Gemini: thử Interactions API (chuẩn mới) trước, nếu không được thì thử
// generateContent (kiểu cũ nhưng Google nói vẫn được hỗ trợ). Ghi lại mã lỗi
// của từng lần thử để biết chính xác nguyên nhân khi thất bại.
async function callGemini(apiKey, prompt) {
  const attempts = [];
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };

  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const raw = await res.text();
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { /* body rỗng hoặc không phải JSON */ }
    return { res, raw, data };
  }

  // Cách 1: Interactions API
  try {
    const { res, raw, data } = await post(
      'https://generativelanguage.googleapis.com/v1beta2/interactions',
      { model: MODELS[0], input: prompt }
    );
    if (res.ok && data) {
      const step = (data.steps || []).find(s => s.type === 'model_output');
      const text = step && step.content && step.content[0] && step.content[0].text;
      if (text) return { text };
    }
    attempts.push({ api: 'interactions', model: MODELS[0], status: res.status, body: raw.slice(0, 300) });
  } catch (e) {
    attempts.push({ api: 'interactions', model: MODELS[0], error: String(e) });
  }

  // Cách 2: generateContent, thử lần lượt từng model
  for (const model of MODELS) {
    try {
      const { res, raw, data } = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { contents: [{ parts: [{ text: prompt }] }] }
      );
      const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      const text = parts && parts[0] && parts[0].text;
      if (res.ok && text) return { text };
      attempts.push({ api: 'generateContent', model, status: res.status, body: raw.slice(0, 300) });
    } catch (e) {
      attempts.push({ api: 'generateContent', model, error: String(e) });
    }
  }
  return { error: attempts };
}

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
    return { statusCode: 500, body: JSON.stringify({ error: 'Server chưa cấu hình GEMINI_API_KEY.' }) };
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
    const out = await callGemini(apiKey, prompt);
    if (out.error) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Gemini không trả kết quả', attempts: out.error }) };
    }

    const clean = out.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const m = clean.match(/\{[\s\S]*\}/);
    let result = null;
    try { result = JSON.parse(m ? m[0] : clean); } catch (e) { result = null; }

    if (!result || !result.chinese) {
      return { statusCode: 502, body: JSON.stringify({ error: 'AI trả về dữ liệu không đọc được', raw: clean.slice(0, 300) }) };
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
