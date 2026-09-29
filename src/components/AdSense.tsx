"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";

declare global {
  interface Window {
    adsbygoogle: unknown[];
  }
}

const ADSENSE_SCRIPT = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

/** 廣告版位定義：每個頁面的廣告區固定投遞兩則廣告 */
export interface AdUnit {
  /** AdSense 廣告帳號（ca-pub-...） */
  client: string;
  /** 廣告版位 ID */
  slot: string;
  /** <ins> 尺寸樣式 */
  style: React.CSSProperties;
  /** 廣告格式（例：auto） */
  format?: string;
  /** 是否隨容器自適應寬度 */
  fullWidthResponsive?: boolean;
}

/** 第一則廣告：橫幅 320x50 */
const bannerUnit: AdUnit = {
  client: "ca-pub-6708300535856225",
  slot: "6395280865",
  style: { display: "block", width: "320px", height: "50px" },
};

/** 第二則廣告：方塊 320x200（與第一則同一廣告帳號 ca-pub-6708300535856225，版位 2839746247） */
const AD_CLIENT_2 = "ca-pub-6708300535856225";
const AD_SLOT_2 = "2839746247";

const boxUnit: AdUnit = {
  client: AD_CLIENT_2,
  slot: AD_SLOT_2,
  style: { display: "block", width: "320px", height: "200px" },
  format: "auto",
  fullWidthResponsive: true,
};

/** 全站廣告區共用的兩則廣告 */
export const AD_UNITS: AdUnit[] = [bannerUnit, boxUnit];

export default function AdSense({ units = AD_UNITS }: { units?: AdUnit[] }) {
  const insRefs = useRef<Array<HTMLModElement | null>>([]);
  const pushedRef = useRef(false);

  useEffect(() => {
    // 每個 <ins> 只 push 一次（React StrictMode 會重跑 effect，重複 push 會讓版位對不上、只填入一則）
    if (pushedRef.current) return;
    pushedRef.current = true;
    try {
      insRefs.current.forEach((el) => {
        if (el) {
          (window.adsbygoogle = window.adsbygoogle || []).push({});
        }
      });
    } catch (error) {
      console.error("AdSense error:", error);
    }
  }, []);

  // 各版位可能屬不同廣告帳號：每個帳號各載入一次 adsbygoogle.js
  const clients = Array.from(new Set(units.map((unit) => unit.client)));

  return (
    <div className="text-center py-4">
      {/* 僅本元件掛載時（sponsorAdEnabled）才載入 AdSense script；lazyOnload 延後至頁面載完。
          CSP script-src 已放行 pagead2.googlesyndication.com host，不依賴 nonce。 */}
      {clients.map((client) => (
        <Script
          key={client}
          src={`${ADSENSE_SCRIPT}?client=${client}`}
          strategy="lazyOnload"
          crossOrigin="anonymous"
        />
      ))}
      <p className="text-sm text-t3 mb-2">&gt;&gt;以下廣告由Google AdSense推播&lt;&lt;</p>

      {units.map((unit, index) => (
        <div
          key={`${unit.client}-${unit.slot}-${index}`}
          className={`flex justify-center${index < units.length - 1 ? " mb-2" : ""}`}
        >
          <ins
            ref={(el) => {
              insRefs.current[index] = el;
            }}
            className="adsbygoogle"
            style={{ ...unit.style, maxWidth: "100%" }}
            data-ad-client={unit.client}
            data-ad-slot={unit.slot}
            data-ad-format={unit.format}
            data-full-width-responsive={unit.fullWidthResponsive ? "true" : undefined}
          />
        </div>
      ))}
    </div>
  );
}
