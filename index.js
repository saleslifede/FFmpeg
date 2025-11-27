import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import path from "path";

const app = express();

// Uploads landen in ./uploads
const upload = multer({ dest: "uploads/" });

// ffmpeg-static als Binary nutzen
ffmpeg.setFfmpegPath(ffmpegPath);

// Body-Parser für Text-Params
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// simpler Healthcheck
app.get("/", (_req, res) => {
  res.send("FFmpeg text-overlay server is running.");
});

// Font (Standard-Linux-Font, auf Render meist vorhanden)
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

// Text für drawtext escapen (sonst knallt ffmpeg bei : \ ')
function escapeDrawtext(text) {
  return (text || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

// POST /render
// Form-Data:
//   video = Datei
//   text  = Overlay-Text
app.post("/render", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video uploaded (field 'video')." });
  }

  const rawText = req.body.text || "Link in Bio";
  const text = escapeDrawtext(rawText);

  const inputPath = req.file.path;
  const outDir = "renders";
  fs.mkdirSync(outDir, { recursive: true });

  const fileName = `out_${Date.now()}.mp4`;
  const outputPath = path.join(outDir, fileName);

  // 1080x1920 + zentrierter Text unten mit schwarzem Box-Background
  const vf =
    "scale=1080:1920:force_original_aspect_ratio=decrease," +
    "pad=1080:1920:(1080-iw)/2:(1920-ih)/2:black," +
    `drawtext=fontfile=${FONT_PATH}:` +
    `text='${text}':` +
    "fontcolor=white:fontsize=48:" +
    "box=1:boxcolor=black@0.45:boxborderw=18:" +
    "x=(w-text_w)/2:y=h-(text_h*2.2)";

  ffmpeg(inputPath)
    .outputOptions([
      "-vf", vf,
      "-r", "60",             // 60 fps
      "-preset", "veryfast",
      "-crf", "22",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-b:a", "128k"
    ])
    .on("end", () => {
      // Upload-Datei aufräumen
      fs.unlink(inputPath, () => {});
      const url = `${req.protocol}://${req.get("host")}/renders/${fileName}`;
      res.json({ success: true, url, width: 1080, height: 1920 });
    })
    .on("error", (err) => {
      console.error("FFmpeg error:", err.message);
      fs.unlink(inputPath, () => {});
      res.status(500).json({ error: err.message });
    })
    .save(outputPath);
});

// fertige Videos statisch ausliefern
app.use("/renders", express.static("renders"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FFmpeg text-overlay server listening on port ${PORT}`);
});
