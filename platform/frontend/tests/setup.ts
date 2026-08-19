import { config } from '@vue/test-utils'
import { createPinia } from 'pinia'

import i18n from '../src/i18n'

config.global.plugins = [i18n, createPinia()]
