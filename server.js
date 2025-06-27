import express from "express";
import multer from "multer";
import ffprobeStatic from 'ffprobe-static';
import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs";

ffmpeg.setFfprobePath(ffprobeStatic.path);

const app = express();
const upload = multer({ dest: "/tmp/uploads" });

/** Helper: Get width and height of a video file */
function getVideoDimensions(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const videoStream = metadata.streams.find(
        (s) => s.codec_type === "video"
      );
      if (!videoStream) return reject(new Error("No video stream found"));
      const width = videoStream.width;
      const height = videoStream.height;
      console.log(`Probed dimensions: ${width}x${height}`);
      resolve({ width, height });
    });
  });
}

app.post("/process-video", upload.single("video"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send("No file uploaded");

  const inputPath = file.path;
  const outputDir = "/tmp/processed";
  fs.mkdirSync(outputDir, { recursive: true });

  const step1Path = path.join(outputDir, `${file.filename}-step1.mp4`);
  const finalPath = path.join(outputDir, `${file.filename}-final.mp4`);

  try {
    /** STEP 1: Remove rotation metadata, scale, etc. */
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
          console.log("✅ Step 1 completed");
          try { fs.unlinkSync(inputPath); } catch {}
          resolve();
        })
        .on("error", reject)
        .save(step1Path);
    });

    /** 🔎 Probe actual dimensions of step1 output */
    const { width, height } = await getVideoDimensions(step1Path);

    /** 💡 Compute dynamic 4:3 crop dimensions */
    const cropWidth = Math.floor((3 / 4) * height);
    const cropFilter = `crop=${cropWidth}:${height}`;
    console.log(`✅ Applying dynamic crop filter: ${cropFilter}`);

    /** STEP 2: Crop to 4:3 aspect ratio */
    await new Promise((resolve, reject) => {
      ffmpeg(step1Path)
        .videoFilter(cropFilter)
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
          console.log("✅ Step 2 completed");
          try { fs.unlinkSync(step1Path); } catch {}
          resolve();
        })
        .on("error", reject)
        .save(finalPath);
    });

    /** ✅ Serve final file */
    res.download(finalPath, "processed-video.mp4", (err) => {
      try { fs.unlinkSync(finalPath); } catch {}
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
