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

      // Find the first video stream
      const videoStream = metadata.streams.find(
        (stream) => stream.codec_type === "video"
      );

      if (!videoStream) return resolve(0);

      // Check for rotation in tags or side_data_list
      const rotationTag = videoStream.tags?.rotate;
      const rotationSideData = videoStream.side_data_list?.find(
        (d) => d.rotation !== undefined
      );

      const rotation =
        rotationTag !== undefined
          ? parseInt(rotationTag)
          : rotationSideData?.rotation ?? 0;

      console.log(rotation)

      resolve(rotation);
    });
  });
}

app.use(express.urlencoded({ extended: true }));

app.post("/process-video", upload.single("video"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send("No file uploaded");

  const inputPath = file.path;
  const outputDir = "/tmp/processed";
  const outputPath = path.join(outputDir, `${file.filename}.mp4`);
  fs.mkdirSync(outputDir, { recursive: true });

  try {
    // Build filter chain
    const filters = [];

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
