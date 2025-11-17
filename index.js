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

// Pfad zu deinem Font (Datei musst du selbst in /fonts ablegen)
const fontPath = path.join(__dirname, 'fonts', 'DejaVuSans.ttf');

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

// Admin UI
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

        <label>Font Size</label><br/>
        <input name="fontSize" value="${cfg.fontSize}" type="number" style="width:100%"/><br/><br/>

        <label>Font Color</label><br/>
        <input name="fontColor" value="${cfg.fontColor}" style="width:100%"/><br/><br/>

        <label>Text Y Offset (Abstand vom unteren Rand)</label><br/>
        <input name="textYOffset" value="${cfg.textYOffset}" type="number" style="width:100%"/><br/><br/>

        <label>Default Template</label><br/>
        <textarea name="defaultTemplate" style="width:100%;height:80px;">${cfg.defaultTemplate}</textarea><br/><br/>

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
    fontSize: Number(req.body.fontSize) || 48,
    fontColor: req.body.fontColor || 'white',
    textYOffset: Number(req.body.textYOffset) || 150,
    defaultTemplate: req.body.defaultTemplate || ''
  };

  saveConfig(newCfg);

  const token = req.query.token || req.body.token || '';
  res.redirect('/admin?token=' + token);
});

// Render-Endpoint für n8n
app.post('/render', async (req, res) => {
  const { videoUrl, text } = req.body;

  if (!videoUrl) {
    return res.status(400).json({ error: 'videoUrl ist Pflicht.' });
  }

  const cfg = loadConfig();
  const [w, h] = (cfg.resolution || '1080x1920').split('x');
  const fontSize = cfg.fontSize || 48;
  const fontColor = cfg.fontColor || 'white';
  const yOffset = cfg.textYOffset || 150;

  const usedText = (text && text.trim().length > 0)
    ? text
    : (cfg.defaultTemplate || '');

  if (!usedText) {
    return res.status(400).json({ error: 'Kein Text angegeben und kein defaultTemplate gesetzt.' });
  }

  const id = uuid();
  const inputPath = path.join('/tmp', `${id}-in.mp4`);
  const outputPath = path.join('/tmp', `${id}-out.mp4`);

  try {
    // 1) Video herunterladen
    const response = await axios.get(videoUrl, { responseType: 'arraybuffer' });
    fs.writeFileSync(inputPath, response.data);

    // 2) ffmpeg-Command bauen
    // Text minimal escapen
    const safeText = usedText
      .replace(/'/g, "\\'")
      .replace(/:/g, '\\:')
      .replace(/\\/g, '\\\\');

    // Prüfen, ob Font existiert – sonst ohne drawtext
    let vfFilters = `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
                    `pad=${w}:${h}:( ${w}-iw)/2:(${h}-ih)/2:black`;

    if (fs.existsSync(fontPath)) {
      vfFilters += `,drawtext=fontfile='${fontPath}':text='${safeText}':` +
                   `fontcolor=${fontColor}:fontsize=${fontSize}:` +
                   `x=(w-text_w)/2:y=h-${yOffset}`;
    } else {
      console.warn('Fontfile nicht gefunden, rendere ohne Text-Overlay:', fontPath);
    }

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
