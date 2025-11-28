import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import path from "path";

const app = express();

// Uploads & Renders
const UPLOAD_DIR = "/tmp/uploads";
const RENDER_DIR = "/tmp/renders";

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(RENDER_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });
ffmpeg.setFfmpegPath(ffmpegPath);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- Helper: Safe-Text + Fontsize ----------

// Text für ASS safe machen
const makeSafeText = (t) =>
  (t || "")
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\r?\n/g, "\\N");

// einfache Autoskalierung nach Länge
const getFontSize = (t) => {
  const len = (t || "").length;

  if (len <= 35) return 64;   // sehr kurz → schön groß
  if (len <= 60) return 56;   // normaler Hook
  if (len <= 90) return 48;   // etwas länger
  if (len <= 120) return 42;  // lang
  return 36;                  // sehr lang → kleiner
};

// ---------- Healthcheck ----------
app.get("/", (_req, res) => {
  res.send("🔥 SalesLife FFmpeg ASS-overlay server is running");
});

// ---------- Hauptendpoint ----------
app.post("/render", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ error: "No video file uploaded (field 'video')." });
  }

  const inputPath = req.file.path;
  const rawText = (req.body.text || "Link in Bio").trim();
  const safeText = makeSafeText(rawText);
  const fontSize = getFontSize(rawText);

  const stamp = Date.now();
  const assPath = `/tmp/ov_${stamp}.ass`;
  const fileName = `out_${stamp}.mp4`;
  const outputPath = path.join(RENDER_DIR, fileName);

  // ---------- ASS-Datei (1080x1920, Mitte/Mitte, Auto-Fontsize) ----------
  const assContent = `
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
;  Name,        Font,        Size, Primary,    Secondary,  Outline,    Back,       B I U S  ScX ScY Sp Angle Border Outline Shadow Align ML MR MV Enc
Style: Caption,DejaVu Sans,${fontSize},&H00FFFFFF,&H000000FF,&H7F000000,&H7F000000,-1,0,0,0,100,100,0,0,1,3,0,5,40,40,40,1

[Events]
; Layer, Start, End,   Style,   Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,9:59:59.00,Caption,,0000,0000,0040,,{\\an5\\bord3\\shad0\\q2\\fsp4}${safeText}
`.trim() + "\n";

  fs.writeFileSync(assPath, assContent, "utf8");

  console.log("[FFMPEG] input:", inputPath);
  console.log("[FFMPEG] ass  :", assPath);
  console.log("[FFMPEG] out  :", outputPath);
  console.log("[FFMPEG] text :", rawText);
  console.log("[FFMPEG] fs   :", fontSize);

  const vfFilters = [
    "scale=1080:1920:force_original_aspect_ratio=decrease",
    "pad=1080:1920:(1080-iw)/2:(1920-ih)/2:black",
    `subtitles=${assPath}:fontsdir=/usr/share/fonts/truetype/dejavu`,
  ];

  ffmpeg(inputPath)
    .videoFilters(vfFilters)
    .outputOptions([
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-r",
      "30",
    ])
    .on("start", (cmdLine) => {
      console.log("[FFMPEG] start:", cmdLine);
    })
    .on("end", () => {
      console.log("[FFMPEG] finished:", outputPath);
      fs.unlink(inputPath, () => {});
      fs.unlink(assPath, () => {});
      const url = `${req.protocol}://${req.get("host")}/renders/${fileName}`;
      res.json({ success: true, url, width: 1080, height: 1920, text: rawText, fontSize });
    })
    .on("error", (err, stdout, stderr) => {
      console.error("[FFMPEG] ERROR:", err.message);
      if (stdout) console.error("[FFMPEG] stdout:", stdout);
      if (stderr) console.error("[FFMPEG] stderr:", stderr);
      fs.unlink(inputPath, () => {});
      fs.unlink(assPath, () => {});
      res.status(500).json({ error: err.message });
    })
    .save(outputPath);
});

// fertige Videos
app.use("/renders", express.static(RENDER_DIR));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 FFmpeg ASS-overlay server listening on port " + PORT);
});
