import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiClientError, api } from '../api'
import type { Me } from '../types'

export const useSessionStore = defineStore('session', () => {
  const me = ref<Me | null>(null)
  const loaded = ref(false)
  const permissions = computed(() => me.value?.permissions ?? [])

  async function load(): Promise<boolean> {
    try {
      me.value = await api<Me>('/api/v1/me')
    } catch (reason) {
      if (!(reason instanceof ApiClientError) || reason.status !== 401) throw reason
      me.value = null
    } finally {
      loaded.value = true
    }
    return me.value !== null
  }

  async function logout(): Promise<void> {
    window.location.assign('/auth/logout')
  }

  function can(permission: string): boolean {
    return permissions.value.includes(permission)
  }

  return { me, loaded, permissions, load, logout, can }
})
