// POST /render
// Form-Data:
//   video = Datei
//   text  = Overlay-Text
app.post("/render", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video file uploaded (field 'video')." });
  }

  const inputPath = req.file.path;
  const rawText = (req.body.text || "Link in Bio").trim();

  // ---------- 1) ASS-Datei bauen ----------

  // Text für ASS cleanen (Backslashes, Klammern, neue Zeilen)
  const safeText = rawText
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\r?\n/g, "\\N");

  const assContent = `
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
; Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,
; Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,
; BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,48,&H00FFFFFF,&H000000FF,&H7F000000,&H7F000000,
-1,0,0,0,100,100,0,0,1,3,0,5,40,40,40,1

[Events]
; Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,9:59:59.00,Caption,,0000,0000,0040,,{\\an5\\bord3\\shad0}${safeText}
`.trim() + "\n";

  const stamp = Date.now();
  const assPath = `/tmp/ov_${stamp}.ass`;

  fs.writeFileSync(assPath, assContent, "utf8");

  // ---------- 2) Output-Datei vorbereiten ----------

  const fileName = `out_${stamp}.mp4`;
  const outputPath = path.join(RENDER_DIR, fileName);

  console.log("[FFMPEG] input:", inputPath);
  console.log("[FFMPEG] ass  :", assPath);
  console.log("[FFMPEG] out  :", outputPath);
  console.log("[FFMPEG] text :", rawText);

  // Filterkette: scale → pad → subtitles(ASS)
  const vfFilters = [
    "scale=1080:1920:force_original_aspect_ratio=decrease",
    "pad=1080:1920:(1080-iw)/2:(1920-ih)/2:black",
    `subtitles=${assPath}:fontsdir=/usr/share/fonts/truetype/dejavu`
  ];

  ffmpeg(inputPath)
    .videoFilters(vfFilters)
    .outputOptions([
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "22",
      "-c:a", "aac",
      "-b:a", "128k",
      "-r", "30"
    ])
    .on("start", (cmdLine) => {
      console.log("[FFMPEG] start:", cmdLine);
    })
    .on("end", () => {
      console.log("[FFMPEG] finished:", outputPath);
      // Aufräumen
      fs.unlink(inputPath, () => {});
      fs.unlink(assPath, () => {});
      const url = `${req.protocol}://${req.get("host")}/renders/${fileName}`;
      res.json({ success: true, url, width: 1080, height: 1920 });
    })
    .on("error", (err, stdout, stderr) => {
      console.error("[FFMPEG] ERROR:", err.message);
      if (stdout) console.error("[FFMPEG] stdout:", stdout);
      if (stderr) console.error("[FFMPEG] stderr:", stderr);
      fs.unlink(inputPath, () => {});
      fs.unlink(assPath, () => {});
      res.status(500).json({ error: err.message });
    });
});
