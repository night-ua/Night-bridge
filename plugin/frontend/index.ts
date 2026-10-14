import { definePlugin } from 'millennium';
import { createElement } from 'react';

export default definePlugin(() => ({
    icon: createElement('span', null, '⇩'),
    content: createElement('div', null, 'Use Nght-Bridge beside Community Hub. Import preferences apply immediately. Listed games show the Nightfile Bot link for additional files. Restart Steam only after installing or enabling the plugin itself.'),
}));
