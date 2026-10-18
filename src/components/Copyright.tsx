"use client";

interface CopyrightProps {
  mode: string;
}

// 資訊安全：頁尾一律不揭露版本號與建置日期（避免幫攻擊者辨識版本）
const POWERED_BY = "Powered by Next.js";

export default function Copyright({ mode }: CopyrightProps) {
  if (mode === "關閉") {
    return <CopyrightSimple />;
  }
  return <CopyrightFull />;
}

function CopyrightFull() {
  return (
    <div className="text-center py-4">
      <table className="text-xs mx-auto" style={{ whiteSpace: "nowrap", width: "auto", borderCollapse: "initial" }}>
        <tbody>
          <tr className="text-center" style={{ background: "transparent" }}>
            <td
              width={45}
              valign="middle"
              className="px-1 pb-1"
              style={{ borderBottom: "none", padding: "0 4px 4px", border: "none" }}
            >
              <img
                width={45}
                src="https://drive.google.com/thumbnail?id=1WxyryafzINOif8hx9zBSvsHM6579nLO3"
                title="Hey!"
                alt="Hey!"
              />
            </td>
            <td style={{ borderBottom: "none", padding: "0", border: "none" }}>
      <div>{POWERED_BY}</div>
              <div className="flex items-center justify-center gap-2 my-1 flex-wrap">
                {/* Donate */}
                <a
                  target="_blank"
                  href="https://p.ecpay.com.tw/36FF207"
                  title="Donate!"
                  className="inline-flex"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width={20}
                    height={20}
                    fill="#e05252"
                  >
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                  </svg>
                </a>
                {/* GitHub */}
                <a
                  target="_blank"
                  href="https://github.com/takan003"
                  title="My GitHub"
                  className="inline-flex"
                >
                  <svg viewBox="0 0 16 16" width={20} height={20} fill="#333">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                </a>
                {/* Website */}
                <a
                  target="_blank"
                  href="https://github.com/takan003/campus-toolkit"
                  title="Visit my website"
                  className="inline-flex"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width={20}
                    height={20}
                    fill="none"
                    stroke="#666"
                    strokeWidth={2}
                  >
                    <circle cx={12} cy={12} r={10} />
                    <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                  </svg>
                </a>
                {/* Line */}
                <a
                  target="_blank"
                  href="https://lin.ee/ti5PPuJ"
                  title="Contact me via Line"
                  className="inline-flex"
                >
                  <svg viewBox="0 0 24 24" width={20} height={20}>
                    <rect width={24} height={24} rx={6} fill="#00B900" />
                    <path
                      d="M12 4.8C7.36 4.8 3.6 7.84 3.6 11.6c0 3.36 2.98 6.18 7.01 6.71.27.06.64.18.73.41.08.21.05.54.03.75l-.12.72c-.04.21-.17.82.72.45 2.73-1.15 7.13-4.19 7.13-7.96C19.1 7.84 16.64 4.8 12 4.8z"
                      fill="white"
                    />
                  </svg>
                </a>
                {/* MIT License */}
                <a
                  target="_blank"
                  href="https://github.com/takan003/campus-toolkit/blob/main/LICENSE"
                  title="MIT LICENSE"
                  className="inline-flex"
                >
                  <svg viewBox="0 0 24 24" width={20} height={20}>
                    <path
                      d="M12 2L4 6v5c0 5.25 3.4 10.15 8 11.5 4.6-1.35 8-6.25 8-11.5V6l-8-4z"
                      fill="#888"
                    />
                    <path
                      d="M9 10l1.5 1.5L15 7"
                      stroke="white"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                </a>
              </div>
              <div>Copyright (c) 2026</div>
              <div>Chang, Chia-Cheng 張家誠</div>
            </td>
            <td
              width={45}
              valign="middle"
              className="px-1 pb-1"
              style={{ borderBottom: "none", padding: "0 4px 4px", border: "none" }}
            >
              <img
                width={45}
                src="https://drive.google.com/thumbnail?id=1TQG38zYkLm7GSjuIfkqNej-DKCm5QfeD"
                title="Hello!"
                alt="Hello!"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CopyrightSimple() {
  return (
    <div className="text-center text-sm py-4">
      <div>{POWERED_BY}</div>
      <div>數位校園工具箱</div>
      <div className="flex items-center justify-center gap-2 mt-1">
        <span>Chang, Chia-Cheng 張家誠</span>
        <a
          target="_blank"
          href="https://github.com/takan003/campus-toolkit/blob/main/LICENSE"
          title="MIT LICENSE"
          className="inline-flex"
        >
          <svg viewBox="0 0 24 24" width={18} height={18}>
            <path
              d="M12 2L4 6v5c0 5.25 3.4 10.15 8 11.5 4.6-1.35 8-6.25 8-11.5V6l-8-4z"
              fill="#888"
            />
            <path
              d="M9 10l1.5 1.5L15 7"
              stroke="white"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </a>
        <a
          target="_blank"
          href="https://github.com/takan003/campus-toolkit"
          title="Visit my website"
          className="inline-flex"
        >
          <svg
            viewBox="0 0 24 24"
            width={18}
            height={18}
            fill="none"
            stroke="#666"
            strokeWidth={2}
          >
            <circle cx={12} cy={12} r={10} />
            <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
          </svg>
        </a>
      </div>
    </div>
  );
}
