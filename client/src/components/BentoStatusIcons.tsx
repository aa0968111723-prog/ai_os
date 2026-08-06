import React from "react";

export type BentoStatusType = "attention" | "working" | "waiting" | "completed";

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

/** 1. 待我處理（鈴鐺 + 驚嘆號） */
export function StatusBellIcon({ size = 32, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      {/* Bell body */}
      <path
        d="M16 4C11.582 4 8 7.582 8 12v7l-2 2v1h20v-1l-2-2v-7c0-4.418-3.582-8-8-8z"
        fill="url(#bento-bell-grad)"
      />
      {/* Bell bottom clapper */}
      <path
        d="M13.5 25a2.5 2.5 0 005 0"
        stroke="#c0392b"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      {/* Badge circle */}
      <circle cx="23" cy="9" r="5" fill="#e74c3c" />
      {/* Exclamation mark */}
      <line
        x1="23"
        y1="6.5"
        x2="23"
        y2="10"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="23" cy="11.5" r="0.8" fill="white" />
      <defs>
        <linearGradient
          id="bento-bell-grad"
          x1="8"
          y1="4"
          x2="24"
          y2="26"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FF6B35" />
          <stop offset="100%" stopColor="#E74C3C" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** 2. AI 執行中（閃電 + 脈衝光） */
export function StatusBoltIcon({ size = 32, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      {/* Glow ring */}
      <circle cx="16" cy="16" r="13" fill="url(#bento-glow-grad)" opacity="0.25" />
      {/* Lightning bolt */}
      <path
        d="M18 4L10 18h7l-3 10 12-14h-7z"
        fill="url(#bento-bolt-grad)"
        stroke="#8BC34A"
        strokeWidth="0.5"
      />
      {/* Circuit dots */}
      <circle cx="12" cy="14" r="1" fill="#CDDC39" opacity="0.8" />
      <circle cx="20" cy="18" r="1" fill="#CDDC39" opacity="0.8" />
      <defs>
        <linearGradient
          id="bento-bolt-grad"
          x1="10"
          y1="4"
          x2="22"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#EEFF41" />
          <stop offset="100%" stopColor="#76FF03" />
        </linearGradient>
        <radialGradient id="bento-glow-grad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#CCFF00" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#CCFF00" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}

/** 3. 等待決策（沙漏） */
export function StatusHourglassIcon({ size = 32, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      {/* Top cap */}
      <rect x="8" y="4" width="16" height="3" rx="1.5" fill="#00897B" />
      {/* Bottom cap */}
      <rect x="8" y="25" width="16" height="3" rx="1.5" fill="#00897B" />
      {/* Hourglass outline */}
      <path d="M10 7 Q10 16 16 16 Q22 16 22 7" fill="url(#bento-sand-top)" />
      <path
        d="M10 25 Q10 16 16 16 Q22 16 22 25"
        fill="url(#bento-sand-bot)"
        opacity="0.5"
      />
      {/* Sand dots */}
      <circle cx="15" cy="19" r="1.2" fill="#26A69A" />
      <circle cx="17" cy="21" r="0.8" fill="#26A69A" opacity="0.7" />
      <circle cx="15.5" cy="22.5" r="0.6" fill="#26A69A" opacity="0.5" />
      <defs>
        <linearGradient
          id="bento-sand-top"
          x1="10"
          y1="7"
          x2="22"
          y2="16"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#00BCD4" />
          <stop offset="100%" stopColor="#00897B" />
        </linearGradient>
        <linearGradient
          id="bento-sand-bot"
          x1="10"
          y1="25"
          x2="22"
          y2="16"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#00BCD4" />
          <stop offset="100%" stopColor="#004D40" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** 4. 已完成成果（勾徽章 + 星芒） */
export function StatusBadgeIcon({ size = 32, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      {/* Star rays */}
      <line x1="16" y1="2" x2="16" y2="5" stroke="#F9A825" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="27" x2="16" y2="30" stroke="#F9A825" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1="16" x2="5" y2="16" stroke="#F9A825" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="27" y1="16" x2="30" y2="16" stroke="#F9A825" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="5.5" y1="5.5" x2="7.5" y2="7.5" stroke="#F9A825" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="24.5" y1="24.5" x2="26.5" y2="26.5" stroke="#F9A825" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="26.5" y1="5.5" x2="24.5" y2="7.5" stroke="#F9A825" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="5.5" y1="26.5" x2="7.5" y2="24.5" stroke="#F9A825" strokeWidth="1.5" strokeLinecap="round" />
      {/* Badge circle */}
      <circle cx="16" cy="16" r="10" fill="url(#bento-badge-grad)" />
      {/* Checkmark */}
      <path
        d="M10.5 16l4 4 7-7"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <defs>
        <linearGradient
          id="bento-badge-grad"
          x1="6"
          y1="6"
          x2="26"
          y2="26"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#66BB6A" />
          <stop offset="100%" stopColor="#1B5E20" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** 統一分發器 */
export function BentoStatusIcon({ type, size = 32, ...props }: { type: BentoStatusType } & IconProps) {
  switch (type) {
    case "attention":
      return <StatusBellIcon size={size} {...props} />;
    case "working":
      return <StatusBoltIcon size={size} {...props} />;
    case "waiting":
      return <StatusHourglassIcon size={size} {...props} />;
    case "completed":
      return <StatusBadgeIcon size={size} {...props} />;
  }
}
