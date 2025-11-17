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

// Pfad zur Config
const configPath = path.join(__dirname, 'config.json');

function loadConfig() {
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
}

// Simple Admin-Auth über Token
function checkAdmin(req, res, next) {
  const pass = process.env.ADMIN_PASSWORD;
  const token = req.query.token || req.body.token;

  if (!pass) return res.status(500).send('ADMIN_PASSWORD not set');
  if (token !== pass) return res.status(403).send('Forbidden');

  next();
}

// Healthcheck
app.get('/', (req, res) => {
  res.send('FFmpeg render service up');
});

// Admin UI (aktuell vor allem für Resolution, Rest optional)
app.get('/admin', checkAdmin, (req, res) => {
  const cfg = loadConfig();
  const token = req.query.token || '';
  const html = `
  <html>
    <body style="font-family: sans-serif; max-width: 600px; margin: 40px auto;">
      <h1>Video Render Settings</h1>
      <form method="POST" action="/admin/save?token=${token}">
        <label>Resolution (z.B. 1080x1920)</label><br/>
        <input name="resolution" value="${cfg.resolution}" style="width:100%"/><br/><br/>
        <button type="submit">Speichern</button>
      </form>
    </body>
  </html>
  `;
  res.send(html);
});

app.post('/admin/save', checkAdmin, (req, res) => {
  const newCfg = {
    resolution: req.body.resolution || '1080x1920',
    // alte Felder lassen wir vorerst drin, aber nutzen sie nicht
    fontSize: 48,
    fontColor: 'white',
    textYOffset: 150,
    defaultTemplate: '🚀 Starte heute. Link in Bio.'
  };

  saveConfig(newCfg);

  const token = req.query.token || req.body.token || '';
  res.redirect('/admin?token=' + token);
});

// Render-Endpoint für n8n
app.post('/render', async (req, res) => {
  const { videoUrl } = req.body;

  if (!videoUrl) {
    return res.status(400).json({ error: 'videoUrl ist Pflicht.' });
  }

  const cfg = loadConfig();
  const [w, h] = (cfg.resolution || '1080x1920').split('x');

  const id = uuid();
  const inputPath = path.join('/tmp', `${id}-in.mp4`);
  const outputPath = path.join('/tmp', `${id}-out.mp4`);

  try {
    // 1) Video herunterladen
    const response = await axios.get(videoUrl, { responseType: 'arraybuffer' });
    fs.writeFileSync(inputPath, response.data);

    // 2) ffmpeg-Command OHNE drawtext (nur scale + pad)
    const vfFilters =
      `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
      `pad=${w}:${h}:( ${w}-iw)/2:(${h}-ih)/2:black`;

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
    return res.status(500).json({ error: 'download or render error', details: e.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Render service listening on port', port);
});
