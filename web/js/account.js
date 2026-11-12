// Sign-in / register sheet: email + password, Google, phone (SMS code).
import { h, openSheet, toast, sheetItem } from "./ui.js";
import { LANG } from "./i18n.js";

const D = {
  title: { ru: "Аккаунт", en: "Account", uz: "Akkaunt" },
  why: { ru: "Войдите, чтобы избранное не пропадало и было на всех устройствах", en: "Sign in so your favourites are kept and follow you across devices", uz: "Sevimlilar yo'qolmasligi va barcha qurilmalarda bo'lishi uchun kiring" },
  email: { ru: "Email", en: "Email", uz: "Email" },
  pass: { ru: "Пароль (от 6 символов)", en: "Password (6+ characters)", uz: "Parol (kamida 6 belgi)" },
  login: { ru: "Войти", en: "Sign in", uz: "Kirish" },
  register: { ru: "Регистрация", en: "Create account", uz: "Ro'yxatdan o'tish" },
  google: { ru: "Войти через Google", en: "Continue with Google", uz: "Google orqali kirish" },
  phone: { ru: "Войти по телефону", en: "Sign in with phone", uz: "Telefon orqali kirish" },
  forgot: { ru: "Забыли пароль?", en: "Forgot password?", uz: "Parolni unutdingizmi?" },
  sent: { ru: "Письмо для сброса пароля отправлено", en: "Password reset email sent", uz: "Parolni tiklash xati yuborildi" },
  phoneHint: { ru: "Номер в формате +992901234567", en: "Number like +992901234567", uz: "Raqam +992901234567 ko'rinishida" },
  sendCode: { ru: "Получить код", en: "Send code", uz: "Kod olish" },
  code: { ru: "Код из SMS", en: "SMS code", uz: "SMS kodi" },
  confirm: { ru: "Подтвердить", en: "Confirm", uz: "Tasdiqlash" },
  back: { ru: "Назад", en: "Back", uz: "Orqaga" },
  logout: { ru: "Выйти", en: "Sign out", uz: "Chiqish" },
  signedIn: { ru: "Вы вошли", en: "Signed in", uz: "Kirdingiz" },
  synced: { ru: "Избранное сохраняется в аккаунте", en: "Favourites are saved to your account", uz: "Sevimlilar akkauntda saqlanadi" },
  or: { ru: "или", en: "or", uz: "yoki" },
  bad_email: { ru: "Неверный email", en: "Invalid email", uz: "Email noto'g'ri" },
  weak: { ru: "Пароль слишком короткий (от 6 символов)", en: "Password is too short (6+ characters)", uz: "Parol juda qisqa (kamida 6 belgi)" },
  in_use: { ru: "Этот email уже зарегистрирован, нажмите «Войти»", en: "Email already registered, use Sign in", uz: "Bu email ro'yxatdan o'tgan, «Kirish» ni bosing" },
  wrong: { ru: "Неверный email или пароль", en: "Wrong email or password", uz: "Email yoki parol noto'g'ri" },
  many: { ru: "Слишком много попыток, попробуйте позже", en: "Too many attempts, try later", uz: "Juda ko'p urinish, keyinroq urinib ko'ring" },
  net: { ru: "Нет соединения", en: "No connection", uz: "Aloqa yo'q" },
  bad_phone: { ru: "Неверный номер телефона", en: "Invalid phone number", uz: "Telefon raqami noto'g'ri" },
  bad_code: { ru: "Неверный или просроченный код", en: "Wrong or expired code", uz: "Kod noto'g'ri yoki eskirgan" },
  domain: { ru: "Этот домен не разрешён в Firebase", en: "This domain is not authorised in Firebase", uz: "Bu domen Firebase'da ruxsat etilmagan" },
  region: { ru: "SMS на этот номер недоступны", en: "SMS to this number is not available", uz: "Bu raqamga SMS yuborib bo'lmaydi" },
  other: { ru: "Не удалось войти, попробуйте ещё раз", en: "Could not sign in, try again", uz: "Kirib bo'lmadi, qayta urinib ko'ring" },
};
const tr = (k) => (D[k] ? D[k][LANG] || D[k].en : k);

const field = (type, ph, attrs = {}) => h("input", { class: "auth-input", type, placeholder: ph, autocomplete: "off", ...attrs });
const btn = (label, onclick, cls = "") => h("button", { class: `auth-btn ${cls}`, type: "button", onclick }, label);

/** Opens the account sheet (sign-in form, or the signed-in account with Sign out). */
export async function openAccount() {
  let A;
  try { A = await import("./auth.js"); } catch (e) { console.warn(e); toast(tr("net")); return; }
  const { signIn, signUp, resetPassword, signInGoogle, sendCode, logout, currentUser, accountLabel, authError } = A;
  openSheet((sheet, dismiss) => {
    const u = currentUser();
    sheet.append(h("div", { class: "sheet-head" }, h("div", null, h("b", null, tr("title")), h("span", null, u ? accountLabel(u) : tr("why")))));
    if (u) {
      sheet.append(h("p", { class: "muted auth-note" }, `✓ ${tr("synced")}`));
      sheet.append(sheetItem("close", tr("logout"), async () => { dismiss(); await logout(); toast(tr("logout")); }));
      return;
    }
    const box = h("div", { class: "auth-box" });
    sheet.append(box);
    const err = h("p", { class: "auth-err", role: "alert" });
    const fail = (e) => { err.textContent = authError(e, tr); console.warn(e); };
    const done = () => { dismiss(); toast(tr("signedIn")); };
    const busy = (b, p) => { b.disabled = true; return p.finally(() => { b.disabled = false; }); };

    function emailView() {
      box.replaceChildren();
      const email = field("email", tr("email"), { autocomplete: "email", inputmode: "email" });
      const pass = field("password", tr("pass"), { autocomplete: "current-password" });
      const go = (fn) => (ev) => {
        err.textContent = "";
        busy(ev.currentTarget, fn(email.value.trim(), pass.value).then(done)).catch(fail);
      };
      const forgot = h("button", { class: "auth-link", type: "button", onclick: () => {
        err.textContent = "";
        if (!email.value.trim()) { err.textContent = tr("bad_email"); return; }
        resetPassword(email.value.trim()).then(() => toast(tr("sent"))).catch(fail);
      } }, tr("forgot"));
      const g = btn(tr("google"), (ev) => { err.textContent = ""; busy(ev.currentTarget, signInGoogle().then(done)).catch(fail); }, "ghost");
      box.append(email, pass, err, btn(tr("login"), go(signIn)), btn(tr("register"), go(signUp), "ghost"), forgot,
        h("div", { class: "auth-or" }, tr("or")), g, btn(tr("phone"), phoneView, "ghost"));
    }

    function phoneView() {
      box.replaceChildren();
      err.textContent = "";
      const phone = field("tel", "+992…", { autocomplete: "tel", inputmode: "tel" });
      const host = h("div", { id: "recaptcha-host" });
      const code = field("text", tr("code"), { autocomplete: "one-time-code", inputmode: "numeric", hidden: true });
      let confirmation = null;
      const main = btn(tr("sendCode"), (ev) => {
        err.textContent = "";
        if (!confirmation) {
          busy(ev.currentTarget, sendCode(phone.value.replace(/[\s()-]/g, ""), host).then((c) => {
            confirmation = c; code.hidden = false; code.focus(); main.textContent = tr("confirm");
          })).catch(fail);
        } else {
          busy(ev.currentTarget, confirmation.confirm(code.value.trim()).then(done)).catch(fail);
        }
      });
      box.append(h("p", { class: "muted auth-note" }, tr("phoneHint")), phone, code, err, main, host, btn(tr("back"), emailView, "ghost"));
    }

    emailView();
  });
}
