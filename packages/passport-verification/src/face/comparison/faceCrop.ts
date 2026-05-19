type ImageLike = {
  uri: string;
  width: number;
  height: number;
};

type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DetectedFace = {
  box: FaceBox;
};

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type FaceCropResult =
  | {
      success: true;
      faceBox: FaceBox;
      cropRect: CropRect;
    }
  | {
      success: false;
      error: string;
    };

// TODO:
// This should use react-native-vision-camera-face-detector
declare function detectFace(image: ImageLike): Promise<DetectedFace[]>;

/**
 * Detects exactly one face and returns a square crop rectangle
 * where the detected face is centered.
 */
export async function getCenteredFaceSquareCrop(
  image: ImageLike
): Promise<FaceCropResult> {
  const faces = await detectFace(image);

  if (faces.length === 0) {
    return {
      success: false,
      error: "No face detected in the image.",
    };
  }

  if (faces.length > 1) {
    return {
      success: false,
      error: "Multiple faces detected in the image.",
    };
  }

  const faceBox = faces[0].box;

  const cropSize = Math.max(faceBox.width, faceBox.height);

  const faceCenterX = faceBox.x + faceBox.width / 2;
  const faceCenterY = faceBox.y + faceBox.height / 2;

  let cropX = faceCenterX - cropSize / 2;
  let cropY = faceCenterY - cropSize / 2;

  // Clamp crop box so it stays inside the image boundaries
  cropX = Math.max(0, Math.min(cropX, image.width - cropSize));
  cropY = Math.max(0, Math.min(cropY, image.height - cropSize));

  // If the image itself is smaller than the crop size, fallback safely
  const finalCropSize = Math.min(cropSize, image.width, image.height);

  return {
    success: true,
    faceBox,
    cropRect: {
      x: Math.round(cropX),
      y: Math.round(cropY),
      width: Math.round(finalCropSize),
      height: Math.round(finalCropSize),
    },
  };
}


/**
 * USAGE EXAMPLE:
 const passportResult = await getCenteredFaceSquareCrop(passportNfcImage);

if (!passportResult.success) {
  throw new Error(passportResult.error);
}

const cameraResult = await getCenteredFaceSquareCrop(cameraImage);

if (!cameraResult.success) {
  throw new Error(cameraResult.error);
}

// Compare the two crop rectangles

*/
