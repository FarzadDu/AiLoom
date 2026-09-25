"use client";

import { useRef, useState, type ChangeEvent, type PointerEvent } from "react";

type Labels = {
  brush: string;
  clear: string;
  hint: string;
  invalid: string;
  uploadMask?: string;
  invalidMask?: string;
  maskReady?: string;
};

export function usableInpaintMask(file: { type: string; size: number } | null,
  source: { width: number; height: number }, mask: { width: number; height: number }): boolean {
  return Boolean(file && file.type === "image/png" && file.size > 0 && file.size <= 8_000_000 &&
    source.width > 0 && source.height > 0 && mask.width === source.width && mask.height === source.height);
}

export function InpaintCanvas({ src, alt, labels, onMaskChange }: {
  src: string; alt: string; labels: Labels; onMaskChange: (file: File | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const maskFileRef = useRef<HTMLInputElement>(null);
  const maskUploadRevisionRef = useRef(0);
  const sourceDimensionsRef = useRef({ width: 0, height: 0 });
  const drawingRef = useRef(false);
  const revisionRef = useRef(0);
  const [brush, setBrush] = useState(48);
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [maskUploadError, setMaskUploadError] = useState("");
  const [uploadedMaskName, setUploadedMaskName] = useState("");

  const onImageLoad = (image: HTMLImageElement) => {
    const { naturalWidth: width, naturalHeight: height } = image;
    maskUploadRevisionRef.current++;
    sourceDimensionsRef.current = { width, height };
    setUploadedMaskName("");
    setMaskUploadError("");
    if (width < 256 || height < 256 || width > 4096 || height > 4096 || width * height > 16_000_000) {
      setInvalid(true);
      setReady(false);
      onMaskChange(null);
      return;
    }
    const canvas = canvasRef.current;
    const mask = maskRef.current;
    const context = mask?.getContext("2d");
    if (!canvas || !mask || !context) return;
    canvas.width = width;
    canvas.height = height;
    mask.width = width;
    mask.height = height;
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    revisionRef.current++;
    setInvalid(false);
    setReady(true);
    onMaskChange(null);
  };

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const bounds = canvas.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * canvas.width / bounds.width,
      y: (event.clientY - bounds.top) * canvas.height / bounds.height };
  };

  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    maskUploadRevisionRef.current++;
    setUploadedMaskName("");
    setMaskUploadError("");
    const canvas = canvasRef.current!;
    const context = canvas.getContext("2d")!;
    const maskContext = maskRef.current!.getContext("2d")!;
    const position = point(event);
    drawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);
    for (const [target, color] of [[context, "#6083ec"], [maskContext, "#fff"]] as const) {
      target.strokeStyle = color;
      target.fillStyle = color;
      target.lineWidth = brush;
      target.lineCap = "round";
      target.lineJoin = "round";
      target.beginPath();
      target.arc(position.x, position.y, brush / 2, 0, Math.PI * 2);
      target.fill();
      target.beginPath();
      target.moveTo(position.x, position.y);
    }
    onMaskChange(null);
  };

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const position = point(event);
    for (const canvas of [canvasRef.current!, maskRef.current!]) {
      const context = canvas.getContext("2d")!;
      context.lineTo(position.x, position.y);
      context.stroke();
    }
  };

  const finish = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    move(event);
    drawingRef.current = false;
    const canvas = canvasRef.current!;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    const revision = ++revisionRef.current;
    maskRef.current!.toBlob(blob => {
      if (revision !== revisionRef.current) return;
      onMaskChange(blob ? new File([blob], "ailoom-mask.png", { type: "image/png" }) : null);
    }, "image/png");
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    maskUploadRevisionRef.current++;
    setUploadedMaskName("");
    setMaskUploadError("");
    revisionRef.current++;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    const mask = maskRef.current!;
    const context = mask.getContext("2d")!;
    context.fillStyle = "#000";
    context.fillRect(0, 0, mask.width, mask.height);
    drawingRef.current = false;
    onMaskChange(null);
  };

  const uploadMask = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    const revision = ++maskUploadRevisionRef.current;
    setMaskUploadError("");
    if (!ready || file.type !== "image/png" || file.size === 0 || file.size > 8_000_000) {
      setMaskUploadError(labels.invalidMask ?? "Use a PNG mask under 8 MB with the same dimensions as the source image.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const allowed = usableInpaintMask(file, sourceDimensionsRef.current,
        { width: bitmap.width, height: bitmap.height });
      bitmap.close();
      if (revision !== maskUploadRevisionRef.current) return;
      if (!allowed) throw new Error("invalid mask dimensions");
      const canvas = canvasRef.current!;
      canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
      const mask = maskRef.current!;
      const context = mask.getContext("2d")!;
      context.fillStyle = "#000";
      context.fillRect(0, 0, mask.width, mask.height);
      revisionRef.current++;
      setUploadedMaskName(file.name);
      onMaskChange(file);
    } catch {
      if (revision === maskUploadRevisionRef.current)
        setMaskUploadError(labels.invalidMask ?? "Use a PNG mask under 8 MB with the same dimensions as the source image.");
    }
  };

  return <div className="inpaint-workspace">
    <div className="inpaint-editor">
      <img src={src} alt={alt} onLoad={event => onImageLoad(event.currentTarget)} />
      <canvas ref={maskRef} hidden aria-hidden="true" />
      <canvas ref={canvasRef} aria-label={labels.hint} onPointerDown={start} onPointerMove={move}
        onPointerUp={finish} onPointerCancel={finish} />
    </div>
    {invalid && <p className="inpaint-message" role="alert">{labels.invalid}</p>}
    {maskUploadError && <p className="inpaint-message" role="alert">{maskUploadError}</p>}
    <div className="inpaint-tools">
      <label>{labels.brush}<input type="range" min={8} max={200} step={4} value={brush}
        onChange={event => setBrush(Number(event.target.value))} disabled={!ready} /></label>
      <button type="button" onClick={clear} disabled={!ready}>{labels.clear}</button>
      <input ref={maskFileRef} className="sr-only" type="file" accept="image/png,.png"
        tabIndex={-1} aria-hidden="true" onChange={event => void uploadMask(event)} />
      <button type="button" onClick={() => maskFileRef.current?.click()} disabled={!ready}>
        {labels.uploadMask ?? "Upload PNG mask"}</button>
      {uploadedMaskName && <span role="status" title={uploadedMaskName}>
        {labels.maskReady ?? "Mask ready"}: {uploadedMaskName}</span>}
    </div>
  </div>;
}
