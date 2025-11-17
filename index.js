const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const { exec } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Healthcheck
app.get('/', (req, res) => {
  res.send('FFmpeg render service up (minimal)');
});

// Render-Endpoint: nur Video zuschneiden auf 1080x1920 (Reels)
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
    // 1) Video herunterladen
    const response = await axios.get(videoUrl, { responseType: 'arraybuffer' });
    fs.writeFileSync(inputPath, response.data);

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
        return res.status(500).json({
          error: 'ffmpeg failed',
          details: stderr.toString()
        });
      }

      try {
        const buffer = fs.readFileSync(outputPath);
        const base64 = buffer.toString('base64');

        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);

        return res.json({
          status: 'done',
          fileBase64: base64,
          mimeType: 'video/mp4'
        });
      } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'read output failed' });
      }
    });
  } catch (e) {
    console.error(e);
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
