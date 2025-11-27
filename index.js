import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import path from "path";

const app = express();

// Uploads landen in /tmp
const upload = multer({ dest: "/tmp/uploads/" });

// ffmpeg-static nutzen
ffmpeg.setFfmpegPath(ffmpegPath);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Render-Ordner
const RENDER_DIR = "/tmp/renders";
fs.mkdirSync(RENDER_DIR, { recursive: true });

// Helper → drawtext escapen
const escapeDrawtext = (t) =>
  (t || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');

// Standard-Font (Render safe)
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

// Random Helper
const rand = (min, max) => (Math.random() * (max - min) + min).toFixed(3);

// Zufalls-Positionen für Text
const randomTextPosition = () => {
  const choices = [
    "y=h-(text_h*2.3)",              // unten
    "y=(h-text_h)/2",                // mitte
    "y=text_h*1.5"                   // oben
  ];
  return choices[Math.floor(Math.random() * choices.length)];
};

// Healthcheck
app.get("/", (_req, res) => {
  res.send("🔥 SalesLife FFmpeg Engine is running");
});

// MAIN ENDPOINT
app.post("/render", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video uploaded" });
    }

    const input = req.file.path;
    const rawText = req.body.text || "Link in Bio";
    const text = escapeDrawtext(rawText);

    const outputName = `out_${Date.now()}.mp4`;
    const output = path.join(RENDER_DIR, outputName);

    // RANDOM EFFECTS (Safe for Render CPU)
    const jitter = rand(0.985, 1.015);     // Tempo Anti-Dupe
    const zoom = rand(1.00, 1.03);        // slight zoom
    const rotate = rand(-0.4, 0.4);       // slight rotate
    const brightness = rand(0.90, 1.15);
    const contrast = rand(0.9, 1.2);

    // Zufällige Textposition
    const textY = randomTextPosition();

    // FULL FFMPEG FILTERKETTE
    const vf = [
      // Resize + pad
      "scale=1080:1920:force_original_aspect_ratio=decrease",
      "pad=1080:1920:(1080-iw)/2:(1920-ih)/2:black",

      // Blur edge falloff
      "boxblur=5:1",

      // minimaler anti-duplicate zoom
      `zoompan=z='${zoom}':d=1`,

      // Rotation +-0.4°
      `rotate=${rotate}*PI/180:ow=rotw(360):oh=roth(360):c=black`,

      // leichte Farbkorrektur
      `eq=brightness=${brightness}:contrast=${contrast}`,

      // TEXT OVERLAY
      `drawtext=fontfile=${FONT_PATH}:text='${text}':fontcolor=white:fontsize=52:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:${textY}`
    ].join(",");

    console.log("Rendering video…");

    ffmpeg(input)
      .outputOptions([
        "-vf", vf,
        "-preset", "veryfast",
        "-crf", "22",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        `-filter:a atempo=${jitter}` // anti-duplicate
      ])
      .on("end", () => {
        fs.unlink(input, () => {});
        const url = `${req.protocol}://${req.get("host")}/renders/${outputName}`;
        res.json({
          success: true,
          url,
          effects: { jitter, zoom, rotate, brightness, contrast }
        });
      })
      .on("error", (err) => {
        console.error("FFmpeg ERROR:", err.message);
        fs.unlink(input, () => {});
        res.status(500).json({ error: err.message });
      })
      .save(output);

  } catch (err) {
    console.error("SERVER ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Renders ausliefern
app.use("/renders", express.static(RENDER_DIR));

app.listen(process.env.PORT || 3000, () =>
  console.log("🔥 FFmpeg Engine läuft auf Port " + (process.env.PORT || 3000))
);
