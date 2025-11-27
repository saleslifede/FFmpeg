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

// -------------------- Pfade & Ordner --------------------

const UPLOAD_DIR = "/tmp/uploads";
const RENDER_DIR = "/tmp/renders";

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(RENDER_DIR, { recursive: true });

// Standard-Font (immer vorhanden auf Render)
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

// Multer: Uploads in /tmp
const upload = multer({ dest: UPLOAD_DIR });

// ffmpeg-static verwenden
ffmpeg.setFfmpegPath(ffmpegPath);

// Body-Parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -------------------- Helper --------------------

// Text für drawtext escapen
const escapeDrawtext = (t) =>
  (t || "")
    .replace(/\\/g, "\\\\")   // Backslashes
    .replace(/:/g, "\\:")    // :
    .replace(/'/g, "\\'")    // '
    .replace(/"/g, '\\"')    // "
    .replace(/\r?\n/g, "\\n");

// -------------------- Routes --------------------

// Healthcheck
app.get("/", (_req, res) => {
  res.send("🔥 SalesLife FFmpeg Engine is running");
});

// POST /render
// multipart/form-data:
//  - video: Datei
//  - text:  Overlay-Text
app.post("/render", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video file uploaded (field 'video')." });
  }

  const inputPath = req.file.path;
  const fileName = `out_${Date.now()}.mp4`;
  const outputPath = path.join(RENDER_DIR, fileName);

  const rawText = req.body.text || "Link in Bio";
  const text = escapeDrawtext(rawText);

  // Filterkette:
  // 1) 1080x1920 letterbox
  // 2) Text GENAU mittig (x & y)
  const vf = [
    "scale=1080:1920:force_original_aspect_ratio=decrease",
    "pad=1080:1920:(1080-iw)/2:(1920-ih)/2:black",
    `drawtext=fontfile=${FONT_PATH}:` +
      `text='${text}':` +
      "fontcolor=white:" +
      "fontsize=54:" +
      "box=1:boxcolor=black@0.45:boxborderw=18:" +
      "x=(w-text_w)/2:" +   // horizontal mittig
      "y=(h-text_h)/2"      // vertikal mittig
  ].join(",");

  console.log("[FFMPEG] input:", inputPath);
  console.log("[FFMPEG] output:", outputPath);
  console.log("[FFMPEG] text:", rawText);
  console.log("[FFMPEG] filters:", vf);

  const command = ffmpeg(inputPath)
    .outputOptions([
      "-vf", vf,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "22",
      "-c:a", "aac",
      "-b:a", "128k",
      "-r", "30",
      "-movflags", "+faststart"
    ])
    .on("end", () => {
      console.log("[FFMPEG] finished:", outputPath);
      fs.unlink(inputPath, () => {}); // Upload löschen
      const url = `${req.protocol}://${req.get("host")}/renders/${fileName}`;
      res.json({
        success: true,
        url,
        width: 1080,
        height: 1920,
        text: rawText
      });
    })
    .on("error", (err) => {
      console.error("[FFMPEG] ERROR:", err.message);
      fs.unlink(inputPath, () => {});
      res.status(500).json({ error: err.message });
    });

  command.save(outputPath);
});

// fertige Videos ausliefern
app.use("/renders", express.static(RENDER_DIR));

// Serverstart
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 FFmpeg text-overlay server listening on port " + PORT);
});
