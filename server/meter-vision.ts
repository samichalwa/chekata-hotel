// Reads a water-meter photo with an AI vision model (Google Gemini or OpenAI), configured in
// Water Sales → Metered customers → Tariffs → Photo reading. Returns what it saw; staff always confirm.
export interface MeterVisionResult { meterNumber: string | null; reading: number | null; readingText: string | null; confidence: "high" | "medium" | "low"; notes: string | null }

const PROMPT = `You are reading a photo of a water meter for monthly billing. Reply with JSON only:
{"meterNumber": string|null, "reading": number|null, "readingText": string|null, "confidence": "high"|"medium"|"low", "notes": string|null}
- meterNumber: the meter's SERIAL / identification number printed, engraved or on a sticker on the meter body or lid (often near a barcode, or starting with letters). It is NOT the consumption register. null if you cannot read it with certainty.
- reading: the cubic-metre (m³) register — the row of rolling digits, usually black/white. Red digits or small dials are fractions of a m³: append them as decimals only if clearly readable, otherwise give whole m³. Drop leading zeros. null if unreadable.
- readingText: the register exactly as shown, including leading zeros.
- confidence: low if the photo is blurry, at an angle, wet, dark or any digit is between positions.
- notes: one short sentence on anything uncertain, else null.
Never guess digits you cannot see.`;

function parse(text: string): MeterVisionResult {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("The photo reader gave no answer. Try again or type the reading.");
  const j = JSON.parse(m[0]);
  const reading = j.reading === null || j.reading === undefined || j.reading === "" ? null : Number(String(j.reading).replace(/[^0-9.]/g, ""));
  return {
    meterNumber: j.meterNumber ? String(j.meterNumber).trim() || null : null,
    reading: reading !== null && Number.isFinite(reading) ? reading : null,
    readingText: j.readingText ? String(j.readingText) : null,
    confidence: ["high", "medium", "low"].includes(j.confidence) ? j.confidence : "low",
    notes: j.notes ? String(j.notes) : null,
  };
}

export async function readMeterPhoto(opts: { provider: string; apiKey: string; model?: string | null; imageBase64: string; mimeType: string }): Promise<MeterVisionResult> {
  const data = opts.imageBase64.replace(/^data:[^,]+,/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    if (opts.provider === "gemini") {
      const model = opts.model?.trim() || "gemini-3.5-flash";
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: opts.mimeType, data } }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Gemini: ${j?.error?.message ?? r.status}`);
      return parse(j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "");
    }
    if (opts.provider === "openai") {
      const model = opts.model?.trim() || "gpt-4o-mini";
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", signal: ctrl.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({ model, temperature: 0, response_format: { type: "json_object" },
          messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "image_url", image_url: { url: `data:${opts.mimeType};base64,${data}`, detail: "high" } }] }] }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`OpenAI: ${j?.error?.message ?? r.status}`);
      return parse(j?.choices?.[0]?.message?.content ?? "");
    }
    throw new Error("Photo reading is not set up. An admin can set it up in Water Sales → Metered customers → Tariffs.");
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("The photo reader took too long. Try again or type the reading.");
    throw e;
  } finally { clearTimeout(timer); }
}

/** Compare meter serials ignoring case, spaces, dashes, slashes and leading zeros. */
export const normSerial = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+(?=\d)/, "");
