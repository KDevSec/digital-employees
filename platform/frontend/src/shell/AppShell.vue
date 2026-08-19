<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { navigationForPermissions } from '../navigation'
import { useSessionStore } from '../stores/session'

const { t } = useI18n()
const session = useSessionStore()
const items = computed(() => navigationForPermissions(session.permissions, t))

const roleNames = computed(() => {
  const roles = session.me?.roles ?? []
  return roles
    .map((role) => {
      const label = t(`app.roles.${role.role_code}`, role.role_code)
      const orgs = role.managed_orgs ?? []
      if (orgs.length === 0) return label
      const orgNames = orgs.map((org) => org.name).join('、')
      return `${label}（${orgNames}）`
    })
    .join(' · ')
})
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <RouterLink class="brand inverse" to="/"><span class="brand-mark light">数</span><span>{{ t('app.brand') }}</span></RouterLink>
      <nav>
        <RouterLink v-for="item in items" :key="item.path" :to="item.path">{{ item.label }}</RouterLink>
      </nav>
      <div class="environment"><span class="status-dot"></span>{{ t('app.environment') }}</div>
    </aside>
    <section class="app-main">
      <header class="topbar">
        <div><strong>{{ session.me?.principal.display_name }}</strong><small>{{ roleNames }}</small></div>
        <button class="button" type="button" @click="session.logout">{{ t('app.logout') }}</button>
      </header>
      <main class="workspace"><RouterView /></main>
    </section>
  </div>
</template>
