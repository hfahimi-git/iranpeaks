import './styles/main.css';
import './App.js';
import { watchForUpdates, releaseDate } from './pwa';

watchForUpdates();

// نمایش زمان انتشار نسخه در فوتر (تاریخ شمسی، وقت تهران، ارقام لاتین)
const releaseEl = document.getElementById('release-info');
const released = releaseDate();
if (releaseEl && released) {
    const opts = { timeZone: 'Asia/Tehran' } as const;
    const date = released.toLocaleDateString('fa-IR-u-nu-latn', { ...opts, year: 'numeric', month: '2-digit', day: '2-digit' });
    const time = released.toLocaleTimeString('fa-IR-u-nu-latn', { ...opts, hour: '2-digit', minute: '2-digit', hour12: false });

    const stamp = document.createElement('bdi'); // برای اینکه اعداد در متن راست‌به‌چپ جابه‌جا نشوند
    stamp.dir = 'ltr';
    stamp.textContent = `${date} ${time}`;
    stamp.title = released.toISOString();

    releaseEl.append(' - نسخه: ', stamp);
}