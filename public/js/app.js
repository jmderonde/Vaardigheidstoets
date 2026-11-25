import { initTip } from './lib.js';
import { register, render } from './router.js';
import { daysView, joinView, loginView } from './views/access.js';
import { setupView } from './views/setup.js';
import { consoleView } from './views/console.js';
import { observerView } from './views/observer.js';
import { displayView } from './views/display.js';
import { reportView } from './views/report.js';

register(/^\/(?:login)?$/, loginView);
register(/^\/days$/, daysView);
register(/^\/admin\/day\/(\d+)$/, setupView);
register(/^\/day\/(\d+)(?:\/(\w+))?\/?$/, consoleView);
register(/^\/join$/, joinView);
register(/^\/obs$/, observerView);
register(/^\/display\/([\w-]+)$/, displayView);
register(/^\/report\/(\d+)\/(\d+)$/, reportView);

initTip();
render();

// Service worker: de app blijft opstarten zonder verbinding (data komt altijd van de server).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
