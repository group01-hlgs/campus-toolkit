"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RolePageShell from "@/components/RolePageShell";
import PersonalInfoRulesPanel from "@/components/PersonalInfoRulesPanel";
import StudentPersonalInfoForm from "@/components/StudentPersonalInfoForm";
import { ROSTER_FIELDS } from "@/types/roster";
import { isUserRole, ROLE_HOME, type UserRole } from "@/types/users";

interface PersonalProfile {
  role: UserRole;
  roleLabel: string;
  name: string;
  email: string;
  account: string;
  academicYear: number;
  semester: number;
  fields: Record<string, string>;
}

export default function PersonalBasicInfo({ role }: { role: UserRole }) {
  const router = useRouter();
  const [profile, setProfile] = useState<PersonalProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/me", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.success || !data.profile) {
        setError(data?.message || "目前無法載入個人基本資料，請稍後再試。");
        return;
      }
      const next = data.profile as PersonalProfile;
      if (!isUserRole(next.role)) {
        setError("登入身分資料無效，請重新登入。");
        return;
      }
      if (next.role !== role) {
        router.replace(ROLE_HOME[next.role]);
        return;
      }
      setProfile(next);
    } catch (loadError) {
      console.error("載入個人基本資料失敗:", loadError);
      setError("目前無法載入個人基本資料，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }, [role, router]);

  useEffect(() => {
    if (role === "admin") {
      setLoading(false);
      return;
    }
    void loadProfile();
  }, [loadProfile, role]);

  const accountHref = role === "admin" ? "/admin/admins" : `${ROLE_HOME[role]}/account`;

  return (
    <RolePageShell>
      <main className="content-width max-w-3xl mb-8">
        <header className="mb-4 text-center">
          <h2 className="text-2xl font-bold text-t1">個人基本資料</h2>
          <p className="text-sm text-t3 mt-1">
            {role === "student"
              ? "檢視與填寫本人本學期的基本資料。"
              : role === "admin"
                ? "管理學生本學期個人資料的填寫規則。"
                : "檢視本人目前身分的基本資料。"}
          </p>
        </header>

        <div className="flex justify-end gap-2 mb-4">
          <button
            type="button"
            onClick={() => router.push(ROLE_HOME[role])}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
          >
            返回功能首頁
          </button>
          <button
            type="button"
            onClick={() => router.push(accountHref)}
            className="border border-themed rounded-lg px-4 py-2 text-sm text-t2 hover:text-t1 cursor-pointer"
          >
            帳號與安全設定
          </button>
        </div>

        {role === "admin" ? (
          <PersonalInfoRulesPanel />
        ) : loading ? (
          <div className="border border-themed rounded-lg bg-card p-8 text-center text-t3" role="status">
            載入個人基本資料中…
          </div>
        ) : error ? (
          <div className="border border-themed rounded-lg bg-card p-6 text-center" role="alert">
            <p className="text-danger mb-4">{error}</p>
            <button
              type="button"
              onClick={() => void loadProfile()}
              className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
            >
              重新載入
            </button>
          </div>
        ) : profile ? (
          role === "student" ? (
            <StudentPersonalInfoForm
              academicYear={profile.academicYear}
              semester={profile.semester}
            />
          ) : (
            <section className="border border-themed rounded-lg bg-card p-5 sm:p-7">
              <div className="mb-5 border-b border-themed pb-4">
                <p className="text-xs text-t3">{profile.roleLabel}</p>
                <h3 className="text-xl font-bold text-t1 mt-1">{profile.name || "—"}</h3>
                <p className="text-sm text-t2 mt-1">
                  {profile.academicYear && profile.semester
                    ? `${profile.academicYear} 學年度第 ${profile.semester} 學期`
                    : "目前學期"}
                </p>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                <InfoRow label="帳號" value={profile.account} />
                <InfoRow label="電子郵件地址" value={profile.email} />
                {ROSTER_FIELDS[role]
                  .filter(({ key }) => key !== "name" && key !== "email" && key !== "account" && key !== "modules")
                  .map(({ key, label }) => (
                    <InfoRow key={key} label={label} value={profile.fields[key]} />
                  ))}
              </dl>
            </section>
          )
        ) : null}
      </main>
    </RolePageShell>
  );
}

function InfoRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="border-b border-themed py-3">
      <dt className="text-xs text-t3">{label}</dt>
      <dd className="text-sm text-t1 mt-1 whitespace-pre-wrap break-words">{value?.trim() || "—"}</dd>
    </div>
  );
}
