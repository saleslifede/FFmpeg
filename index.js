import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import path from "path";

const app = express();

// Uploads in /tmp
const upload = multer({ dest: "/tmp/uploads/" });

// ffmpeg-static Binary
ffmpeg.setFfmpegPath(ffmpegPath);

// Body Parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Output-Folder
const RENDER_DIR = "/tmp/renders";
fs.mkdirSync(RENDER_DIR, { recursive: true });

// Font-Verzeichnis für subtitles-Filter
const FONTS_DIR = "/usr/share/fonts/truetype/dejavu";

// ---------- Helper ----------

// Text säubern (kein harter Escape mehr nötig, ASS kann mehr ab)
function cleanText(raw) {
  return (raw || "Link in Bio").trim();
}

// Einfaches ASS-Template für 1080x1920, Text unten mittig mit Box
function buildAss(text) {
  const safeText = text
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\r?\n/g, "\\N");

  return `
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
; Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,
; Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,
; BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,48,&H00FFFFFF,&H000000FF,&H7F000000,&H7F000000,
-1,0,0,0,100,100,0,0,1,3,0,2,40,40,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,9:59:59.00,Caption,,0000,0000,0080,,{\\an2\\bord3\\shad0}${safeText}
`.trim() + "\n";
}

// ---------- Routes ----------

// Healthcheck
app.get("/", (_req, res) => {
  res.send("🔥 SalesLife FFmpeg Engine is running (subtitles mode)");
});

// OPTIONAL: Filter-Liste checken (nur zum Debuggen)
// import { spawn } from "child_process";
// app.get("/debug/filters", (_req, res) => {
//   const p = spawn(ffmpegPath, ["-filters"]);
//   let out = "";
//   p.stdout.on("data", d => out += d.toString());
//   p.stderr.on("data", d => out += d.toString());
//   p.on("close", () => res.type("text/plain").send(out));
// });

// Haupt-Endpoint
app.post("/render", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video file uploaded (field 'video')." });
  }

  const inputPath = req.file.path;
  const text = cleanText(req.body.text);

  // ASS-Datei und Output-Datei
  const stamp = Date.now();
  const assPath = `/tmp/ov_${stamp}.ass`;
  const fileName = `out_${stamp}.mp4`;
  const outputPath = path.join(RENDER_DIR, fileName);

  // ASS-Datei schreiben
  const assContent = buildAss(text);
  fs.writeFileSync(assPath, assContent, "utf8");

  console.log("[FFMPEG] input:", inputPath);
  console.log("[FFMPEG] ass  :", assPath);
  console.log("[FFMPEG] out  :", outputPath);
  console.log("[FFMPEG] text :", text);

  // Filterkette: scale -> pad -> subtitles(ASS)
  const vfFilters = [
    "scale=1080:1920:force_original_aspect_ratio=decrease",
    "pad=1080:1920:(1080-iw)/2:(1920-ih)/2:black",
    `subtitles=${assPath}:fontsdir=${FONTS_DIR}`,
  ];

  ffmpeg(inputPath)
    .videoFilters(vfFilters)
    .outputOptions([
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "22",
      "-c:a", "aac",
      "-b:a", "128k",
      "-r", "30",
    ])
    .on("start", (cmdLine) => {
      console.log("[FFMPEG] start:", cmdLine);
    })
    .on("end", () => {
      console.log("[FFMPEG] finished:", outputPath);
      fs.unlink(inputPath, () => {});
      fs.unlink(assPath, () => {});
      const url = `${req.protocol}://${req.get("host")}/renders/${fileName}`;
      res.json({ success: true, url, width: 1080, height: 1920 });
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

// fertige Videos ausliefern
app.use("/renders", express.static(RENDER_DIR));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 SalesLife FFmpeg Engine listening on port ${PORT}`);
});
