import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/**
 * Reusable live camera capture control.
 * Opens a dialog with a video preview from the device camera (phone camera,
 * tablet camera, or desktop webcam), lets the user snap a still frame, then
 * hands back a File the caller can use exactly like a chosen file-input file.
 *
 * Physical document scanners (TWAIN/WIA) are not addressable from the
 * browser, so scanned documents should continue to be attached via the
 * regular "Choose file" input once the scanner software saves them to disk.
 * This component only adds the "live camera" capture path.
 */
export function CameraCapture({ onCapture, buttonLabel = "Use camera", testId }: { onCapture: (file: File) => void; buttonLabel?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { toast } = useToast();

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startStream = async () => {
    setError(null);
    setReady(false);
    setSnapshot(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access isn't supported in this browser. Use \"Choose file\" instead.");
      return;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setReady(true);
    } catch (err: any) {
      setError(err?.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access, or use \"Choose file\" instead." : "Could not open the camera. Use \"Choose file\" instead.");
    }
  };

  useEffect(() => {
    if (open) startStream();
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setSnapshot(canvas.toDataURL("image/jpeg", 0.92));
    stopStream();
  };

  const handleRetake = () => {
    setSnapshot(null);
    startStream();
  };

  const handleUsePhoto = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) {
        toast({ title: "Couldn't capture photo", description: "Please try again.", variant: "destructive" });
        return;
      }
      const file = new File([blob], `camera-capture-${Date.now()}.jpg`, { type: "image/jpeg" });
      onCapture(file);
      setOpen(false);
    }, "image/jpeg", 0.92);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) stopStream();
    setOpen(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid={testId}>
        <Camera className="h-4 w-4 mr-1" /> {buttonLabel}
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Capture photo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : snapshot ? (
            <img src={snapshot} alt="Captured document" className="w-full rounded-md border" data-testid="img-camera-snapshot" />
          ) : (
            <div className="relative rounded-md overflow-hidden border bg-black">
              <video ref={videoRef} className="w-full aspect-video object-contain" muted playsInline data-testid="video-camera-preview" />
              {!ready && <p className="absolute inset-0 flex items-center justify-center text-sm text-white">Starting camera…</p>}
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>
        <DialogFooter className="gap-2">
          {snapshot ? (
            <>
              <Button type="button" variant="outline" onClick={handleRetake} data-testid="button-camera-retake">
                <RotateCcw className="h-4 w-4 mr-1" /> Retake
              </Button>
              <Button type="button" onClick={handleUsePhoto} data-testid="button-camera-use-photo">
                <Check className="h-4 w-4 mr-1" /> Use this photo
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} data-testid="button-camera-cancel">
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button type="button" onClick={handleCapture} disabled={!ready} data-testid="button-camera-snap">
                <Camera className="h-4 w-4 mr-1" /> Capture
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
