import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import path from "path";

const app = express();

// Uploads in /tmp (schnell auf Render)
const upload = multer({ dest: "/tmp/uploads/" });

// ffmpeg-static Binary setzen
ffmpeg.setFfmpegPath(ffmpegPath);

// Body Parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Output-Folder
const RENDER_DIR = "/tmp/renders";
fs.mkdirSync(RENDER_DIR, { recursive: true });

// Fallback-Font (DejaVu ist auf Render in der Regel vorhanden)
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

// ---------- Helper ----------

// Text für drawtext entschärfen
function cleanOverlayText(raw) {
  return (raw || "Link in Bio")
    .replace(/\\/g, "\\\\")   // Backslash
    .replace(/:/g, "\\:")     // : escapen
    .replace(/'/g, "\\'")     // '
    .replace(/"/g, '\\"')     // "
    .trim();
}

// ---------- Routes ----------

// Healthcheck
app.get("/", (_req, res) => {
  res.send("🔥 SalesLife FFmpeg Engine is running");
});

// Optional: Liste aller Filter checken
// Aufruf: https://dein-host/debug/filters
// Nur zu Debug-Zwecken benutzen!
/*
import { spawn } from "child_process";
app.get("/debug/filters", (_req, res) => {
  const p = spawn(ffmpegPath, ["-filters"]);
  let out = "";
  p.stdout.on("data", (d) => (out += d.toString()));
  p.stderr.on("data", (d) => (out += d.toString()));
  p.on("close", () => {
    res.type("text/plain").send(out);
  });
});
*/

// Haupt-Endpoint: 1080x1920 + Text einbrennen
app.post("/render", upload.single("video"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file uploaded (field 'video')." });
    }

    const inputPath = req.file.path;
    const text = cleanOverlayText(req.body.text);

    const fileName = `out_${Date.now()}.mp4`;
    const outputPath = path.join(RENDER_DIR, fileName);

    console.log("[FFMPEG] input:", inputPath);
    console.log("[FFMPEG] output:", outputPath);
    console.log("[FFMPEG] text:", text);

    const command = ffmpeg(inputPath)
      // 1) Filter-Kette über videoFilters (kein -vf String)
      .videoFilters([
        "scale=1080:1920:force_original_aspect_ratio=decrease",
        "pad=1080:1920:(1080-iw)/2:(1920-ih)/2:black",
        {
          filter: "drawtext",
          options: {
            fontfile: FONT_PATH,
            text,                     // bereits gesäubert
            fontcolor: "white",
            fontsize: 48,
            box: 1,
            boxcolor: "black@0.45",
            boxborderw: 18,
            x: "(w-text_w)/2",
            y: "h-(text_h*2.2)",
          },
        },
      ])
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
        // Upload-Datei aufräumen
        fs.unlink(inputPath, () => {});
        const url = `${req.protocol}://${req.get("host")}/renders/${fileName}`;
        res.json({
          success: true,
          url,
          width: 1080,
          height: 1920,
        });
      })
      .on("error", (err, stdout, stderr) => {
        console.error("[FFMPEG] ERROR:", err.message);
        if (stdout) console.error("[FFMPEG] stdout:", stdout);
        if (stderr) console.error("[FFMPEG] stderr:", stderr);
        fs.unlink(inputPath, () => {});
        res.status(500).json({
          error: err.message,
        });
      })
      .save(outputPath);

  } catch (e) {
    console.error("[SERVER] fatal error:", e);
    return res.status(500).json({ error: e.message || "Internal server error" });
  }
});

// fertige Videos ausliefern
app.use("/renders", express.static(RENDER_DIR));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 SalesLife FFmpeg Engine listening on port ${PORT}`);
});
