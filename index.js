import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";

const app = express();
const upload = multer({ dest: "uploads/" });

ffmpeg.setFfmpegPath(ffmpegPath);

// HEALTH CHECK
app.get("/", (req, res) => {
  res.send("FFmpeg server is running.");
});

// RENDER ENDPOINT
app.post("/render", upload.single("video"), (req, res) => {
  const input = req.file.path;
  const output = `output_${Date.now()}.mp4`;

  ffmpeg(input)
    .outputOptions([
      "-vf scale=1080:1920",
      "-r 60",
      "-preset veryfast"
    ])
    .save(output)
    .on("end", () => {
      const fileUrl = `${req.protocol}://${req.get("host")}/${output}`;
      res.json({ success: true, url: fileUrl });
    })
    .on("error", (err) => {
      res.status(500).json({ error: err.message });
    });
});

// STATIC SERVE
app.use(express.static("."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
