// Netlify Function: nhận danh sách từ vựng, gọi Google Gemini API (MIỄN PHÍ,
// không cần thẻ tín dụng) để tự đặt câu ví dụ đúng ngữ pháp cho từng từ.
// API key đọc từ biến môi trường phía server, KHÔNG bao giờ lộ ra trình duyệt.

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
    const out = await callGemini(apiKey, prompt);
    if (out.error) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Gemini không trả kết quả', attempts: out.error }) };
    }

    const clean = out.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const m = clean.match(/\[[\s\S]*\]/);
    let sentences = [];
    try { sentences = JSON.parse(m ? m[0] : clean); } catch (e) { sentences = []; }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentences })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
