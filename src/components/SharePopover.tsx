import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Share2, Copy, Download, Mail, Link2, QrCode, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import QRCode from "qrcode";

interface SharePopoverProps {
  shareUrl: string;
  projectName: string;
}

const SharePopover = ({ shareUrl, projectName }: SharePopoverProps) => {
  const [tab, setTab] = useState("share");
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (tab === "qr" && !qrDataUrl) {
      QRCode.toDataURL(shareUrl, {
        width: 400,
        margin: 2,
        color: { dark: "#212121", light: "#FFFFFF" },
        type: "image/png" as const,
      }).then(setQrDataUrl).catch(() => {});
    }
  }, [tab, shareUrl, qrDataUrl]);

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast({ title: "Link copied" });
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadQR = () => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `qr_${projectName.replace(/\s+/g, "_")}.png`;
    a.click();
  };

  const sendEmail = () => {
    if (!email) {
      toast({ title: "Please enter an email address", variant: "destructive" });
      return;
    }
    const subject = encodeURIComponent(`Check out ${projectName} — AR Experience`);
    const body = encodeURIComponent(
      `${message ? message + "\n\n" : ""}View the AR experience here:\n${shareUrl}`
    );
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, "_self");
    toast({ title: "Opening email client…" });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="default" size="sm" className="w-full gap-2">
          <Share2 className="h-3.5 w-3.5" />
          Share Experience
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogTitle className="text-base font-semibold">Share Experience</DialogTitle>
        <div className="space-y-4">
          <ToggleGroup
            type="single"
            value={tab}
            onValueChange={(v) => v && setTab(v)}
            className="w-full"
          >
            <ToggleGroupItem value="share" className="flex-1 gap-1.5 text-xs">
              <Link2 className="h-3.5 w-3.5" />
              Share Link
            </ToggleGroupItem>
            <ToggleGroupItem value="qr" className="flex-1 gap-1.5 text-xs">
              <QrCode className="h-3.5 w-3.5" />
              QR Code
            </ToggleGroupItem>
          </ToggleGroup>

          {tab === "share" && (
            <div className="space-y-3">
              {/* Copy link */}
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={shareUrl}
                  className="h-8 text-xs font-mono flex-1"
                />
                <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={copyLink}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {/* Email form */}
              <div className="border-t pt-3 space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Or send via email</p>
                <div>
                  <Label className="text-xs">Recipient email</Label>
                  <Input
                    type="email"
                    placeholder="client@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-8 text-sm mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Message (optional)</Label>
                  <Input
                    placeholder="Take a look at this experience…"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="h-8 text-sm mt-1"
                  />
                </div>
                <Button size="sm" className="w-full gap-2" onClick={sendEmail}>
                  <Mail className="h-3.5 w-3.5" />
                  Send via Email
                </Button>
              </div>
            </div>
          )}

          {tab === "qr" && (
            <div className="space-y-3 flex flex-col items-center">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="QR Code" className="w-48 h-48 rounded-md border" />
              ) : (
                <div className="w-48 h-48 rounded-md border bg-muted animate-pulse" />
              )}
              <Button size="sm" variant="outline" className="gap-2" onClick={downloadQR}>
                <Download className="h-3.5 w-3.5" />
                Download QR
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SharePopover;
