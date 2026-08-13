import { useEffect, useState } from "react";
import type { VisualChoicePreview as PreviewResource } from "@shared/visualChoiceTypes";

function CompositionDiagram({ resource }: { resource: Extract<PreviewResource, { kind: "composition" }> }) {
  const close = resource.motif === "close" || resource.motif === "extreme-close";
  const wide = resource.motif === "wide";
  const full = resource.motif === "full";
  const shoulder = resource.motif === "over-shoulder";
  const headR = close ? (resource.motif === "extreme-close" ? 26 : 19) : wide ? 7 : full ? 10 : 13;
  const headY = resource.motif === "low-angle" ? 27 : resource.motif === "high-angle" ? 42 : 34;
  return (
    <svg viewBox="0 0 120 72" role="img" aria-label={resource.alt} className="visual-choice-preview__svg">
      <rect x="2" y="2" width="116" height="68" rx="7" className="visual-choice-preview__frame" />
      <path d="M12 58H108" className="visual-choice-preview__ground" />
      {shoulder && <path d="M6 64 Q22 26 43 64" className="visual-choice-preview__foreground" />}
      <circle cx={shoulder ? 75 : 60} cy={headY} r={headR} className="visual-choice-preview__subject" />
      {!close && <path d={`M${shoulder ? 75 : 60} ${headY + headR}v${full ? 25 : 18}`} className="visual-choice-preview__subject-line" />}
      {resource.motif === "push-in" && <path d="M16 36h22m-8-8 8 8-8 8M104 36H82m8-8-8 8 8 8" className="visual-choice-preview__motion" />}
      {resource.motif === "static" && <path d="M14 15h13v8H14zM93 15h13v8H93z" className="visual-choice-preview__motion" />}
      {(resource.motif === "low-angle" || resource.motif === "high-angle") && (
        <path d={resource.motif === "low-angle" ? "M17 56 35 39m-2 9 2-9-9 2" : "M17 16 35 33m-9-1 9 1-1-9"} className="visual-choice-preview__motion" />
      )}
    </svg>
  );
}

function PoseDiagram({ resource }: { resource: Extract<PreviewResource, { kind: "pose" }> }) {
  const running = resource.motif === "running";
  const sitting = resource.motif === "sitting";
  const looking = resource.motif === "looking_back";
  const reaching = resource.motif === "reaching" || resource.motif === "pointing";
  return (
    <svg viewBox="0 0 120 72" role="img" aria-label={resource.alt} className={`visual-choice-preview__svg energy-${resource.energy}`}>
      <path d="M12 62H108" className="visual-choice-preview__ground" />
      <circle cx={looking ? 66 : 58} cy="18" r="8" className="visual-choice-preview__subject" />
      <path d={sitting ? "M58 26 53 44 72 48" : running ? "M58 26 48 43 68 47" : "M58 26 58 47"} className="visual-choice-preview__subject-line" />
      <path d={reaching ? "M57 31 87 26M58 32 43 41" : running ? "M54 32 37 24M55 33 75 27" : "M58 32 44 43M58 32 72 42"} className="visual-choice-preview__subject-line" />
      <path d={sitting ? "M53 44 40 61M72 48 80 61" : running ? "M48 43 31 60M68 47 86 59" : "M58 47 47 62M58 47 69 62"} className="visual-choice-preview__subject-line" />
      {resource.energy === "dynamic" && <path d="M21 25h17M16 36h20" className="visual-choice-preview__motion" />}
      {looking && <path d="M57 18h-8m3-4-4 4 4 4" className="visual-choice-preview__motion" />}
    </svg>
  );
}

function ExpressionDiagram({ resource }: { resource: Extract<PreviewResource, { kind: "expression" }> }) {
  const sad = resource.motif === "sad" || resource.motif === "worried";
  const happy = resource.motif === "smile" || resource.motif === "happy";
  const surprised = resource.motif === "surprised";
  const angry = resource.motif === "angry" || resource.motif === "determined";
  return (
    <svg viewBox="0 0 120 72" role="img" aria-label={resource.alt} className="visual-choice-preview__svg">
      <circle cx="60" cy="36" r="27" className="visual-choice-preview__face" />
      <path d={angry ? "M41 27l12 4M79 27l-12 4" : sad ? "M41 31l12-3M79 31l-12-3" : "M42 29h11M67 29h11"} className="visual-choice-preview__subject-line" />
      <circle cx="48" cy="36" r={surprised ? 3.5 : 2.5} className="visual-choice-preview__eye" />
      <circle cx="72" cy="36" r={surprised ? 3.5 : 2.5} className="visual-choice-preview__eye" />
      {surprised ? <circle cx="60" cy="50" r="5" className="visual-choice-preview__mouth" /> : <path d={happy ? "M47 47 Q60 58 73 47" : sad ? "M48 54 Q60 43 72 54" : "M49 50h22"} className="visual-choice-preview__subject-line" />}
    </svg>
  );
}

export function VisualChoicePreview({ resource }: { resource: PreviewResource }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  useEffect(() => { setFailedSrc(null); }, [resource.kind === "image" ? resource.src : resource.kind]);
  if (resource.kind === "image") {
    if (failedSrc === resource.src && resource.fallback) return <VisualChoicePreview resource={resource.fallback} />;
    return <img src={resource.thumbnailSrc ?? resource.src} alt={resource.alt} loading="lazy" className="visual-choice-preview__image" onError={() => setFailedSrc(resource.src)} />;
  }
  if (resource.kind === "composition") return <CompositionDiagram resource={resource} />;
  if (resource.kind === "pose") return <PoseDiagram resource={resource} />;
  if (resource.kind === "expression") return <ExpressionDiagram resource={resource} />;
  if (resource.kind === "swatch") {
    return (
      <span
        role="img"
        aria-label={resource.alt}
        className="visual-choice-preview__swatch"
        style={{ background: `linear-gradient(135deg, ${resource.colors.join(", ")})` }}
      />
    );
  }
  return <span role="img" aria-label={resource.alt} className="visual-choice-preview__fallback">{resource.icon}</span>;
}
