import {
  ArrowCircleUp,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  ArrowsClockwise,
  ArrowSquareOut,
  Check,
  Cube,
  FileText,
  FolderSimple,
  ImageSquare,
  LockKey,
  MagicWand,
  MusicNote,
  Plus,
  SpinnerGap,
  Trash,
  WarningCircle,
  VideoCamera,
  X,
} from "@phosphor-icons/react";
import type { IconProps } from "@phosphor-icons/react";
import type { FC, SVGProps } from "react";

type Props = IconProps & { className?: string };

const base = { weight: "regular" as const };

export const LogoMark = (p: Props) => <ArrowsClockwise {...base} {...p} weight="bold" />;
export const TransformIcon = (p: Props) => <ArrowsClockwise {...base} {...p} weight="bold" />;
export const ImageIcon = (p: Props) => <ImageSquare {...base} {...p} />;
export const VideoIcon = (p: Props) => <VideoCamera {...base} {...p} />;
export const AudioIcon = (p: Props) => <MusicNote {...base} {...p} />;
export const DocIcon = (p: Props) => <FileText {...base} {...p} />;
export const UploadIcon = (p: Props) => <ArrowCircleUp {...base} {...p} />;
export const FolderIcon = (p: Props) => <FolderSimple {...base} {...p} />;
export const TrashIcon = (p: Props) => <Trash {...base} {...p} />;
export const CheckIcon = (p: Props) => <Check {...base} {...p} />;
export const XIcon = (p: Props) => <X {...base} {...p} />;
export const AlertIcon = (p: Props) => <WarningCircle {...base} {...p} />;
export const LockIcon = (p: Props) => <LockKey {...base} {...p} />;
export const ShieldIcon = (p: Props) => <LockKey {...base} {...p} />;
export const ExternalIcon = (p: Props) => <ArrowSquareOut {...base} {...p} />;
export const SpinnerIcon = (p: Props) => <SpinnerGap {...base} {...p} className={`animate-spin ${p.className ?? ""}`} />;
export const PlusIcon = (p: Props) => <Plus {...base} {...p} />;
export const BoxIcon = (p: Props) => <Cube {...base} {...p} />;
export const WandIcon = (p: Props) => <MagicWand {...base} {...p} />;
export const ArrowIcon = (p: Props) => <ArrowRight {...base} {...p} />;
export const ArrowUpIcon = (p: Props) => <ArrowUp {...base} {...p} />;
export const ArrowDownIcon = (p: Props) => <ArrowDown {...base} {...p} />;

const AsciiArt: FC<SVGProps<SVGSVGElement>> = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    {...props}
  >
    {/*
      A tiny real ASCII-art figure — a cat face — rendered in monospace
      using `currentColor` so it inherits any accent used across the UI
      (teal/cyan for the ASCII tile in this app).
    */}
    <text
      x="50%"
      y="6.5"
      dominantBaseline="middle"
      textAnchor="middle"
      fontFamily="monospace, monospace"
      fontSize="6.6"
      fontWeight="700"
      fill="currentColor"
    >
      /\_/\
    </text>
    <text
      x="50%"
      y="13.2"
      dominantBaseline="middle"
      textAnchor="middle"
      fontFamily="monospace, monospace"
      fontSize="6.6"
      fontWeight="700"
      fill="currentColor"
    >
      ( o.o )
    </text>
    <text
      x="50%"
      y="19.9"
      dominantBaseline="middle"
      textAnchor="middle"
      fontFamily="monospace, monospace"
      fontSize="6.6"
      fontWeight="700"
      fill="currentColor"
    >
      &gt; ^ &lt;
    </text>
  </svg>
);

export const AsciiIcon = (p: Props) => <AsciiArt {...p} className={p.className} />;
