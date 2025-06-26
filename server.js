// server.js
import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs";

const app = express();
const upload = multer({ dest: "/tmp/uploads" });

app.post("/process-video", upload.single("video"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send("No file uploaded");

  const outputPath = `/tmp/processed/${file.filename}.mp4`;
  fs.mkdirSync("/tmp/processed", { recursive: true });

  // Example: Rotate 90 degrees clockwise and crop 4:3 centered
  ffmpeg(file.path)
    .videoFilter("transpose=1", "crop=ih*3/4:ih") // rotate + crop
    .outputOptions("-preset fast")
    .save(outputPath)
    .on("end", () => {
      // Delete the original upload file after processing
      fs.unlinkSync(file.path);

      // Send back the processed video as file stream
      res.download(outputPath, "processed-video.mp4", (err) => {
        // Optionally delete processed file after download
        fs.unlinkSync(outputPath);
      });
    })
    .on("error", (err) => {
      console.error(err);
      res.status(500).send("Video processing failed");
    });
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
