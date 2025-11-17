const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const { exec } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Healthcheck
app.get('/', (req, res) => {
  res.send('FFmpeg render service up (streaming)');
});

// Render-Endpoint: Video -> 1080x1920 (Reels), Streaming-Output
app.post('/render', async (req, res) => {
  const { videoUrl } = req.body;

  if (!videoUrl) {
    return res.status(400).json({ error: 'videoUrl ist Pflicht.' });
  }

  const width = 1080;
  const height = 1920;

  const id = uuid();
  const inputPath = path.join('/tmp', `${id}-in.mp4`);
  const outputPath = path.join('/tmp', `${id}-out.mp4`);

  try {
    // 1) Video per Stream herunterladen (kein voller Buffer im RAM)
    const response = await axios({
      method: 'GET',
      url: videoUrl,
      responseType: 'stream',
    });

    const writeStream = fs.createWriteStream(inputPath);

    await new Promise((resolve, reject) => {
      response.data.pipe(writeStream);
      response.data.on('error', reject);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // 2) ffmpeg-Command OHNE drawtext (nur scale + pad)
    const vfFilters =
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:( ${width}-iw)/2:(${height}-ih)/2:black`;

    const cmd = `${ffmpegPath} -y -i "${inputPath}" ` +
      `-vf "${vfFilters}" ` +
      `-c:v libx264 -preset veryfast -crf 22 -c:a copy "${outputPath}"`;

    console.log('Running ffmpeg command:', cmd);

    exec(cmd, (error, stdout, stderr) => {
      console.log('FFmpeg stdout:', stdout);
      console.error('FFmpeg stderr:', stderr);

      if (error) {
        try { fs.existsSync(inputPath) && fs.unlinkSync(inputPath); } catch {}
        try { fs.existsSync(outputPath) && fs.unlinkSync(outputPath); } catch {}

        return res.status(500).json({
          error: 'ffmpeg failed',
          details: stderr.toString()
        });
      }

      // 3) Ergebnis als Stream zurückgeben (kein Base64)
      res.setHeader('Content-Type', 'video/mp4');

      const readStream = fs.createReadStream(outputPath);

      readStream.on('error', (err) => {
        console.error('ReadStream error:', err);
        try { fs.existsSync(inputPath) && fs.unlinkSync(inputPath); } catch {}
        try { fs.existsSync(outputPath) && fs.unlinkSync(outputPath); } catch {}
        res.status(500).end('read output failed');
      });

      res.on('close', () => {
        try { fs.existsSync(inputPath) && fs.unlinkSync(inputPath); } catch {}
        try { fs.existsSync(outputPath) && fs.unlinkSync(outputPath); } catch {}
      });

      readStream.pipe(res);
    });
  } catch (e) {
    console.error(e);
    try { fs.existsSync(inputPath) && fs.unlinkSync(inputPath); } catch {}
    try { fs.existsSync(outputPath) && fs.unlinkSync(outputPath); } catch {}
    return res.status(500).json({
      error: 'download or render error',
      details: e.message
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Render service listening on port', port);
});
