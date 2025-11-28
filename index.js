import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ----------------------------------------------------
// TEMP-DIRS
// ----------------------------------------------------
const UPLOAD_DIR = "/tmp/uploads";
const RENDER_DIR = "/tmp/renders";

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(RENDER_DIR, { recursive: true });

// Upload Middleware
const upload = multer({ dest: UPLOAD_DIR });

// FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Body Parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ----------------------------------------------------
// TEXT WRAPPING → Nie wieder abgeschnittene Texte
// ----------------------------------------------------
const wrapTextForAss = (text, maxCharsPerLine = 22) => {
  const words = (text || "").trim().split(/\s+/);
  const lines = [];
  let current = "";

  for (const w of words) {
    const tmp = current ? current + " " + w : w;
    if (tmp.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
    } else {
      current = tmp;
    }
  }
  if (current) lines.push(current);

  return lines.join("\\N");
};

// ASS-safe
const makeSafeAssText = (t) =>
  (t || "")
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\r?\n/g, "\\N");

// ----------------------------------------------------
// HEALTHCHECK
// ----------------------------------------------------
app.get("/", (_req, res) => {
  res.send("🔥 SalesLife FFmpeg ASS-overlay server is running");
});

// ----------------------------------------------------
// RENDER ENDPOINT
// ----------------------------------------------------
app.post("/render", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video uploaded" });
  }

  const inputPath = req.file.path;
  const rawText = (req.body.text || "Link in Bio").trim();

  // Auto wrap + escape
  const wrapped = wrapTextForAss(rawText);
  const safeText = makeSafeAssText(wrapped);

  // ASS File
  const stamp = Date.now();
  const assPath = `/tmp/ov_${stamp}.ass`;

  const fontSize = 52;

  const assContent = `
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Style: Caption,DejaVu Sans,${fontSize},&H00FFFFFF,&H000000FF,&H7F000000,&H7F000000,
-1,0,0,0,100,100,0,0,1,3,0,5,80,80,60,1

[Events]
Dialogue: 0,0:00:00.00,9:59:59.00,Caption,,0000,0000,0060,,{\\an5\\bord3\\shad0\\q2}${safeText}
`.trim();

  fs.writeFileSync(assPath, assContent, "utf8");

  const fileName = `out_${stamp}.mp4`;
  const outputPath = path.join(RENDER_DIR, fileName);

  console.log("[FFMPEG] input:", inputPath);
  console.log("[FFMPEG] ass:", assPath);
  console.log("[FFMPEG] output:", outputPath);
  console.log("[FFMPEG] text:", rawText);
  console.log("[FFMPEG] wrapped:", wrapped);

  const filters = [
    "scale=1080:1920:force_original_aspect_ratio=decrease",
    "pad=1080:1920:(1080-iw)/2:(1920-ih)/2:black",
    `subtitles=${assPath}:fontsdir=/usr/share/fonts/truetype/dejavu`
  ];

  ffmpeg(inputPath)
    .videoFilters(filters)
    .outputOptions([
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "22",
      "-c:a", "aac",
      "-b:a", "128k",
      "-r", "30"
    ])
    .on("end", () => {
      fs.unlink(inputPath, () => {});
      fs.unlink(assPath, () => {});
      const url = `${req.protocol}://${req.get("host")}/renders/${fileName}`;
      res.json({ success: true, url });
    })
    .on("error", (err) => {
      console.error("FFMPEG ERROR:", err.message);
      fs.unlink(inputPath, () => {});
      fs.unlink(assPath, () => {});
      res.status(500).json({ error: err.message });
    })
    .save(outputPath);
});

// Static videos
app.use("/renders", express.static(RENDER_DIR));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 FFmpeg ASS-overlay server listening on " + PORT));
