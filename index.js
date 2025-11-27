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

// -------------------- Pfade & Directories --------------------

const UPLOAD_DIR = "/tmp/uploads";
const RENDER_DIR = "/tmp/renders";

// Font-Ordner (falls du Montserrat reinlegst)
const FONT_DIR = path.join(__dirname, "fonts");
const MONTSERRAT_PATH = path.join(FONT_DIR, "Montserrat-Regular.ttf");

// Fallback-Font (Linux Standard)
const DEJAVU_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(RENDER_DIR, { recursive: true });

// Multer: Uploads nach /tmp
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
    .replace(/:/g, "\\:")    // Doppelpunkte
    .replace(/'/g, "\\'")    // Single Quotes
    .replace(/"/g, '\\"')    // Double Quotes
    .replace(/\r?\n/g, "\\n"); // Zeilenumbrüche

// Font wählen (wenn du Montserrat nicht willst, leg ihn einfach nicht in /fonts)
const getFontPath = () => {
  if (fs.existsSync(MONTSERRAT_PATH)) {
    console.log("[FONT] Using Montserrat:", MONTSERRAT_PATH);
    return MONTSERRAT_PATH;
  }
  console.warn("[FONT] Montserrat not found, falling back to DejaVu");
  return DEJAVU_PATH;
};

// -------------------- Routes --------------------

// Healthcheck
app.get("/", (_req, res) => {
  res.send("🔥 SalesLife FFmpeg Engine is running");
});

// POST /render
// multipart/form-data
//   - video: Datei
//   - text:  Overlay-Text
// optional:
//   - speed: Audio-Geschwindigkeit (z.B. 1.03)
app.post("/render", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video file uploaded (field 'video')." });
  }

  const inputPath = req.file.path;
  const fileName = `out_${Date.now()}.mp4`;
  const outputPath = path.join(RENDER_DIR, fileName);

  const rawText = req.body.text || "Link in Bio";
  const text = escapeDrawtext(rawText);

  const fontPath = getFontPath();

  // leichtes Audio-Tempo (optional)
  const atempo = req.body.speed ? Number(req.body.speed) : 1.03;
  const atempoSafe = isNaN(atempo) ? 1.03 : Math.min(Math.max(atempo, 0.5), 2.0);

  // Filterkette:
  // 1) Resize auf 1080x1920 (Seitenverhältnis beibehalten)
  // 2) Padding auf 1080x1920 mit schwarzem Rand
  // 3) leichter Farbboost & Schärfe
  // 4) Text **mittig-mittig** mit Box
  const vfParts = [
    "scale=1080:1920:force_original_aspect_ratio=decrease",
    "pad=1080:1920:(1080-iw)/2:(1920-ih)/2:black",
    "eq=contrast=1.05:saturation=1.08:brightness=0.02",
    "unsharp=lx=3:ly=3:la=0.8:cx=3:cy=3:ca=0.4",
    `drawtext=fontfile=${fontPath}:` +
      `text='${text}':` +
      "fontcolor=white:" +
      "fontsize=54:" +
      "line_spacing=8:" +
      "box=1:boxcolor=black@0.45:boxborderw=18:" +
      "x=(w-text_w)/2:" +      // horizontal exakt mittig
      "y=(h-text_h)/2"         // <<< HIER: vertikal mittig statt unten
  ];

  console.log("[FFMPEG] input:", inputPath);
  console.log("[FFMPEG] output:", outputPath);
  console.log("[FFMPEG] text:", rawText);
  console.log("[FFMPEG] filters:", vfParts.join(","));
  console.log("[FFMPEG] atempo:", atempoSafe);

  const command = ffmpeg(inputPath)
    .outputOptions([
      "-vf", vfParts.join(","),             // unsere Filterkette
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "22",
      "-c:a", "aac",
      "-b:a", "128k",
      "-af", `atempo=${atempoSafe.toFixed(2)}`,
      "-r", "30",
      "-movflags", "+faststart"
    ])
    .on("end", () => {
      console.log("[FFMPEG] finished:", outputPath);
      // Upload-Cleanup
      fs.unlink(inputPath, () => {});
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
