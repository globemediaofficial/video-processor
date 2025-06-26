// server.js
import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffprobeStatic from "ffprobe-static";
import path from "path";
import fs from "fs";

const app = express();
const upload = multer({ dest: "/tmp/uploads" });

ffmpeg.setFfprobePath(ffprobeStatic.path);

// Helper: Get rotation metadata
function getVideoRotation(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const rotationTag = metadata.streams[0]?.tags?.rotate || 0;

      const rotation = Number(rotationTag);

      console.log(rotation);
      
      const adjustedRotation = rotation === 0 ? 0 : rotation - 90;
      
      resolve(rotation);
    });
  });
}

app.post("/process-video", upload.single("video"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send("No file uploaded");

  const inputPath = file.path;
  const outputDir = "/tmp/processed";
  const outputPath = path.join(outputDir, `${file.filename}.mp4`);
  fs.mkdirSync(outputDir, { recursive: true });

  try {
    const rotation = await getVideoRotation(inputPath);

    console.log(rotation)

    // Build filter chain
    const filters = [];

    // Only rotate if needed
    if (rotation === 90) filters.push("transpose=1"); // clockwise
    else if (rotation === 180) filters.push("transpose=2,transpose=2"); // 180
    else if (rotation === 270) filters.push("transpose=2"); // counter-clockwise

    // Crop to center 4:3 portrait (480x640 final)
    filters.push("crop=ih*3/4:ih");
    filters.push("scale=720:960");

    ffmpeg(inputPath)
      .outputOptions([
         "-preset fast",
         "-movflags +faststart",   // <-- critical for iOS streaming
         "-c:v libx264",
         "-profile:v baseline",    // baseline profile helps compatibility
         "-level 3.0",
         "-pix_fmt yuv420p",
         "-an",
         "-map_metadata -1", // <-- Remove all metadata here
      ])
      .videoFilter(filters.join(","))
      .on("end", () => {
        fs.unlinkSync(inputPath);
        res.download(outputPath, "processed-video.mp4", (err) => {
          fs.unlinkSync(outputPath); // clean up
        });
      })
      .on("error", (err) => {
        console.error("FFmpeg error:", err);
        res.status(500).send("Video processing failed");
      })
      .save(outputPath);
  } catch (err) {
    console.error("Metadata error:", err);
    fs.unlinkSync(inputPath);
    res.status(500).send("Failed to analyze video");
  }
});

const PORT = process.env.PORT || 8910;
app.listen(PORT, () => {
  console.log(`Video processor running on port ${PORT}`);
});
