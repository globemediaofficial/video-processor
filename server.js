import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs";

const app = express();
const upload = multer({ dest: "/tmp/uploads" });

app.post("/process-video", upload.single("video"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send("No file uploaded");

  const inputPath = file.path;
  const outputDir = "/tmp/processed";
  fs.mkdirSync(outputDir, { recursive: true });

  // Intermediate and final paths
  const step1Path = path.join(outputDir, `${file.filename}-step1.mp4`);
  const finalPath = path.join(outputDir, `${file.filename}-final.mp4`);

  try {
    // STEP 1: Rotate, strip metadata, scale
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          "-preset fast",
          "-movflags +faststart",
          "-c:v libx264",
          "-profile:v baseline",
          "-level 3.0",
          "-pix_fmt yuv420p",
          "-an",
          "-map_metadata -1"
        ])
        .on("end", () => {
          console.log("Step 1 completed");
          fs.unlinkSync(inputPath);
          resolve();
        })
        .on("error", reject)
        .save(step1Path);
    });

    // STEP 2: Crop to 4(height):3(width) aspect ratio
    await new Promise((resolve, reject) => {
      ffmpeg(step1Path)
        .videoFilter("crop=ih*3/4:ih")
        .outputOptions([
          "-preset fast",
          "-movflags +faststart",
          "-c:v libx264",
          "-profile:v baseline",
          "-level 3.0",
          "-pix_fmt yuv420p",
          "-an",
          "-map_metadata -1"
        ])
        .on("end", () => {
          console.log("Step 2 completed");
          fs.unlinkSync(step1Path);
          resolve();
        })
        .on("error", reject)
        .save(finalPath);
    });

    // ✅ Serve final processed video
    res.download(finalPath, "processed-video.mp4", (err) => {
      try {
        fs.unlinkSync(finalPath);
      } catch {}
    });
  } catch (err) {
    console.error("Processing error:", err);
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(step1Path); } catch {}
    try { fs.unlinkSync(finalPath); } catch {}
    res.status(500).send("Video processing failed");
  }
});

const PORT = process.env.PORT || 8910;
app.listen(PORT, () => {
  console.log(`Video processor running on port ${PORT}`);
});
