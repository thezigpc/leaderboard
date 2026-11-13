import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function Qr({ text, size = 160 }: { text: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, { margin: 1, width: size * 2, color: { dark: "#000000", light: "#ffffff" } })
      .then((u) => live && setSrc(u))
      .catch(() => setSrc(""));
    return () => {
      live = false;
    };
  }, [text, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt={`QR code for ${text}`} /> : null;
}
