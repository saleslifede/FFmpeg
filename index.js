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

const UPLOAD_DIR = "/tmp/uploads";
const RENDER_DIR = "/tmp/renders";

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(RENDER_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });

ffmpeg.setFfmpegPath(ffmpegPath);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -----------------------------------------------------
// ESCAPE ASS TEXT
// -----------------------------------------------------
function escapeAssText(text) {
  return (text || "")
    .replace(/\\/g, "\\\\")  // ONLY escape user-backslashes
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}");
}

// -----------------------------------------------------
// AUTO-WRAP MIT \N (für perfekte Mitte/Mitte)
// -----------------------------------------------------
function wrapAssText(text, maxChars = 26) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";

  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (test.length > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);

  return lines.join("\\N");   // echte ASS-Newlines
}

// -----------------------------------------------------
// ROUTE /render
// -----------------------------------------------------
app.post("/render", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video file uploaded." });
  }

  const inputPath = req.file.path;
  const stamp = Date.now();

  const rawText = (req.body.text || "Link in Bio").trim();

  // 1) User-Text escapen
  const escaped = escapeAssText(rawText);

  // 2) Word-wrap + echte Newlines
  const wrapped = wrapAssText(escaped);

  // 3) ASS-File generieren
  const assPath = `/tmp/ov_${stamp}.ass`;
  const outputPath = `/tmp/renders/out_${stamp}.mp4`;

  const assContent = `
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Style: Caption,DejaVu Sans,52,&H00FFFFFF,&H000000FF,&H7F000000,&H7F000000,
-1,0,0,0,100,100,0,0,1,3,0,5,40,40,40,1

[Events]
Dialogue: 0,0:00:00.00,9:59:59.00,Caption,,0000,0000,0000,,{\\an5}${wrapped}
`.trim();

  fs.writeFileSync(assPath, assContent, "utf8");

  // -----------------------------------------------------
  // FFMPEG COMMAND
  // -----------------------------------------------------

  const cmd = ffmpeg(inputPath)
    .outputOptions([
      "-y",
      "-vf",
      `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(1080-iw)/2:(1920-ih)/2:black,subtitles=${assPath}:fontsdir=/usr/share/fonts/truetype/dejavu`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "22",
      "-c:a", "aac",
      "-b:a", "128k",
      "-r", "30",
    ])
    .on("end", () => {
      fs.unlink(inputPath, () => {});
      fs.unlink(assPath, () => {});
      const url = `${req.protocol}://${req.get("host")}/renders/out_${stamp}.mp4`;
      res.json({ success: true, url });
    })
    .on("error", err => {
      fs.unlink(inputPath, () => {});
      fs.unlink(assPath, () => {});
      res.status(500).json({ error: err.message });
    });

  cmd.save(outputPath);
});

app.use("/renders", express.static(RENDER_DIR));

app.listen(10000, () => {
  console.log("🚀 FFmpeg ASS-overlay server listening on 10000");
});
