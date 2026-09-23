import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AdminPage, ApplicationPage, ContractorForm } from './PlatformPages'
import { platformApi, PlatformError, type Profile, type ProfileList } from './platform'
import { mockOptions } from './mocks/fixtures'

// jsdom has no native dialog methods; real focus trapping and Escape are tested in the browser suite.
const dialogMethods = ['showModal', 'close'] as const
const originalDialogMethods = dialogMethods.map((key) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key),
)
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    },
  })
})
afterAll(() => {
  dialogMethods.forEach((key, index) => {
    const descriptor = originalDialogMethods[index]
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key)
  })
})

const adminProfile: Profile = {
  id: 'USR-private',
  name: 'Профиль администратора',
  city: 'Алматы',
  categories: ['Ведущий'],
  event_formats: ['корпоратив'],
  languages: ['русский'],
  price_from_kzt: 250000,
  max_hours: 6,
  busy_dates: [],
  description: 'Описание профиля, которое доступно для подробного просмотра.',
  contact_email: 'private-contact@example.com',
  synthetic: true,
  price_imputed: false,
  city_imputed: false,
  status: 'pending',
  source: 'application',
  revision: 1,
  created_at: '2026-09-23T10:00:00Z',
  updated_at: '2026-09-23T10:00:00Z',
  moderation_note: '',
}
const adminList = (items = [adminProfile], total = items.length, offset = 0): ProfileList => ({
  items,
  total,
  offset,
  limit: 12,
  storage: 'sqlite',
  counts: { pending: total, approved: 0, rejected: 0 },
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
async function loginAdmin() {
  fireEvent.change(screen.getByLabelText('Токен администратора'), {
    target: { value: 'test-only-admin-token' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Войти в панель' }))
  await screen.findByLabelText('Статус анкет')
}
function renderAdmin() {
  return render(<AdminPage options={mockOptions} optionsError={null} onRetry={vi.fn()} />)
}
const openProfile = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Открыть анкету ' + adminProfile.name }))

describe('admin session and conflicts', () => {
  it('never displays the token after login and clears contacts, notes and selection on logout', async () => {
    vi.spyOn(platformApi, 'list').mockResolvedValue(adminList())
    renderAdmin()
    expect(screen.getByLabelText('Токен администратора')).toHaveAttribute('type', 'password')
    await loginAdmin()
    openProfile()
    await screen.findByText('private-contact@example.com')
    fireEvent.change(screen.getByLabelText('Комментарий администратора'), {
      target: { value: 'Приватная причина' },
    })
    expect(document.body.textContent).not.toContain('test-only-admin-token')
    expect(screen.queryByLabelText('Токен администратора')).not.toBeInTheDocument()
    expect(JSON.stringify(localStorage) + JSON.stringify(sessionStorage)).not.toContain(
      'test-only-admin-token',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Выйти из панели' }))
    expect(screen.getByLabelText('Токен администратора')).toHaveValue('')
    expect(document.body.textContent).not.toContain('private-contact@example.com')
    expect(document.body.textContent).not.toContain('Приватная причина')
    await loginAdmin()
    expect(screen.queryByLabelText('Комментарий администратора')).not.toBeInTheDocument()
  })

  it('does not restore a private list after logout even when transport ignores abort', async () => {
    const stale = deferred<ProfileList>()
    const list = vi
      .spyOn(platformApi, 'list')
      .mockResolvedValueOnce(adminList())
      .mockReturnValueOnce(stale.promise)
    renderAdmin()
    await loginAdmin()
    fireEvent.click(screen.getByRole('button', { name: 'Обновить список' }))
    const signal = list.mock.calls[1][3]
    fireEvent.click(screen.getByRole('button', { name: 'Выйти из панели' }))
    expect(signal?.aborted).toBe(true)
    await act(async () => stale.resolve(adminList()))
    expect(screen.queryByLabelText('Статус анкет')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Открыть анкету/ })).not.toBeInTheDocument()
  })

  it('ignores a stale unauthorized add response after a new login', async () => {
    const stale = deferred<Profile>()
    vi.spyOn(platformApi, 'list').mockResolvedValue(adminList())
    vi.spyOn(platformApi, 'add').mockReturnValueOnce(stale.promise)
    renderAdmin()
    await loginAdmin()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить подрядчика' }))
    fillApplication()
    submit()
    fireEvent.click(screen.getByRole('button', { name: 'Выйти из панели' }))
    await loginAdmin()
    await act(async () => stale.reject(new PlatformError('Старый отказ', 401)))
    expect(screen.getByLabelText('Статус анкет')).toBeVisible()
    expect(screen.queryByText('Старый отказ')).not.toBeInTheDocument()
  })

  it('blocks a stale revision after 409 and never repeats moderation automatically', async () => {
    const list = vi.spyOn(platformApi, 'list').mockResolvedValue(adminList())
    const moderate = vi
      .spyOn(platformApi, 'moderate')
      .mockRejectedValue(new PlatformError('Данные изменились. Обновите список.', 409))
    renderAdmin()
    await loginAdmin()
    openProfile()
    fireEvent.click(screen.getByRole('button', { name: 'Одобрить анкету' }))
    await screen.findByText('Данные изменились. Обновите список.')
    expect(moderate).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Одобрить анкету' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Удалить анкету' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Обновить список' }))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.queryByText('Данные изменились. Обновите список.')).not.toBeInTheDocument(),
    )
    openProfile()
    expect(screen.getByRole('button', { name: 'Одобрить анкету' })).toBeEnabled()
  })

  it.each([401, 403])('clears private data on access failure %s', async (status) => {
    vi.spyOn(platformApi, 'list')
      .mockResolvedValueOnce(adminList())
      .mockRejectedValueOnce(new PlatformError('Доступ запрещён', status))
    renderAdmin()
    await loginAdmin()
    openProfile()
    fireEvent.click(screen.getByRole('button', { name: 'Обновить список' }))
    await screen.findByLabelText('Токен администратора')
    expect(screen.queryByText('private-contact@example.com')).not.toBeInTheDocument()
    expect(screen.getByText('Доступ запрещён')).toBeVisible()
  })
  it('allows rejection and deletion when an old profile fails current approval rules', async () => {
    vi.spyOn(platformApi, 'list').mockResolvedValue(
      adminList([{ ...adminProfile, max_hours: null }]),
    )
    const moderate = vi
      .spyOn(platformApi, 'moderate')
      .mockRejectedValue(
        new PlatformError(
          'Нужно подать исправленную анкету перед одобрением.',
          409,
          {},
          'invalid_profile',
        ),
      )
    renderAdmin()
    await loginAdmin()
    openProfile()
    fireEvent.click(screen.getByRole('button', { name: 'Одобрить анкету' }))
    await screen.findByText('Нужно подать исправленную анкету перед одобрением.')
    expect(moderate).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Одобрить анкету' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Отклонить анкету' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Удалить анкету' })).toBeEnabled()
  })

  it('requires a rejection reason and focuses its field', async () => {
    vi.spyOn(platformApi, 'list').mockResolvedValue(adminList())
    const moderate = vi.spyOn(platformApi, 'moderate')
    renderAdmin()
    await loginAdmin()
    openProfile()
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить анкету' }))
    expect(moderate).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Комментарий администратора')).toHaveFocus()
    expect(screen.getByLabelText('Комментарий администратора')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('recovers to an existing page when the final page was removed elsewhere', async () => {
    const last = { ...adminProfile, id: 'page-two', name: 'Последняя страница' }
    const list = vi
      .spyOn(platformApi, 'list')
      .mockResolvedValueOnce(adminList([adminProfile], 25))
      .mockResolvedValueOnce(adminList([last], 25, 12))
      .mockResolvedValueOnce(adminList([], 1, 12))
      .mockResolvedValueOnce(adminList())
    renderAdmin()
    await loginAdmin()
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
    await screen.findByRole('button', { name: 'Открыть анкету Последняя страница' })
    fireEvent.click(screen.getByRole('button', { name: 'Обновить список' }))
    await screen.findByRole('button', { name: 'Открыть анкету ' + adminProfile.name })
    expect(list.mock.calls[3][2]).toBe(0)
    expect(screen.getByText('1–1 из 1')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Назад' })).toBeDisabled()
  })

  it('does not present a failed refresh after a saved action as an empty catalog', async () => {
    vi.spyOn(platformApi, 'list')
      .mockResolvedValueOnce(adminList())
      .mockRejectedValueOnce(new PlatformError('Нет сети'))
    vi.spyOn(platformApi, 'moderate').mockResolvedValue({
      ...adminProfile,
      status: 'approved',
      revision: 2,
    })
    renderAdmin()
    await loginAdmin()
    openProfile()
    fireEvent.click(screen.getByRole('button', { name: 'Одобрить анкету' }))
    await screen.findByRole('heading', { name: 'Список не загружен' })
    expect(screen.getByText('Анкета одобрена и доступна в подборе.')).toBeVisible()
    expect(screen.queryByText('Здесь пока нет анкет')).not.toBeInTheDocument()
  })
})

afterEach(() => vi.restoreAllMocks())

function fillApplication() {
  const values = {
    name: 'Анна Тестовая',
    city: 'Алматы',
    contact_email: 'anna@example.com',
    description: 'Провожу корпоративы с живой музыкой и интерактивной программой.',
    price_from_kzt: '250 000',
    max_hours: '6,5',
  }
  for (const [name, value] of Object.entries(values))
    fireEvent.change(document.getElementById('application-' + name)!, { target: { value } })
  for (const name of ['Ведущий', 'Корпоратив', 'Русский'])
    fireEvent.click(screen.getByRole('checkbox', { name }))
}
const submit = () => fireEvent.submit(document.getElementById('contractor-application')!)

describe('public contractor application', () => {
  it('preserves data and focuses a field after a server validation error', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(
        new PlatformError('Проверьте отмеченные поля.', 422, { contact_email: 'Исправьте email.' }),
      )
    render(<ContractorForm options={mockOptions} onSubmit={send} />)
    fillApplication()
    submit()
    await screen.findByText('Исправьте email.')
    await waitFor(() => expect(document.getElementById('application-contact_email')).toHaveFocus())
    expect(screen.getByLabelText('Имя или название команды')).toHaveValue('Анна Тестовая')
    expect(screen.getByRole('checkbox', { name: 'Ведущий' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Отправить на проверку' })).toBeEnabled()
  })

  it('locks double submission and sends only the contract fields', async () => {
    let resolve!: () => void
    const send = vi.fn().mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    )
    render(<ContractorForm options={mockOptions} onSubmit={send} />)
    fillApplication()
    fireEvent.change(document.getElementById('application-max_hours')!, { target: { value: '' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ведущий' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Флорист' }))
    submit()
    submit()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toMatchObject({
      price_from_kzt: 250000,
      max_hours: null,
      busy_dates: [],
      synthetic: false,
    })
    expect(send.mock.calls[0][0]).not.toHaveProperty('status')
    expect(screen.getByRole('button', { name: 'Сохраняем анкету…' })).toBeDisabled()
    await act(async () => resolve())
  })

  it.each([false, true])(
    'updates duration validation and focus after category changes (direct=%s)',
    async (direct) => {
      const send = vi.fn().mockResolvedValue(undefined)
      render(<ContractorForm options={mockOptions} onSubmit={send} direct={direct} />)
      fillApplication()
      const duration = screen.getByLabelText('Максимальная длительность, ч')
      fireEvent.change(duration, { target: { value: '' } })
      expect(duration).toBeRequired()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Декоратор' }))
      submit()
      expect(send).not.toHaveBeenCalled()
      expect(duration).toHaveFocus()
      expect(duration).toHaveAttribute('aria-invalid', 'true')
      fireEvent.click(screen.getByRole('checkbox', { name: 'Ведущий' }))
      expect(duration).not.toBeRequired()
      expect(duration).toHaveAttribute('aria-invalid', 'false')
      expect(screen.getByText(/Можно оставить пустым/)).toBeVisible()
      submit()
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      expect(send.mock.calls[0][0]).toMatchObject({ categories: ['Декоратор'], max_hours: null })
    },
  )

  it('supports picking, removing and validating busy dates without silent deduplication', () => {
    render(<ContractorForm options={mockOptions} onSubmit={vi.fn()} />)
    const picker = screen.getByLabelText('Выбрать дату в календаре')
    expect(picker).toHaveAttribute('min', mockOptions.calendar.min)
    expect(picker).toHaveAttribute('max', mockOptions.calendar.max)
    fireEvent.change(picker, { target: { value: '2026-11-14' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить дату' }))
    expect(screen.getByLabelText('Занятые даты', { exact: true })).toHaveValue('2026-11-14')
    fireEvent.change(picker, { target: { value: '2026-11-14' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить дату' }))
    expect(screen.getByText(/В списке есть повторяющиеся даты/)).toBeVisible()
    expect(screen.getByLabelText('Занятые даты', { exact: true })).toHaveValue('2026-11-14')
    fireEvent.click(screen.getByRole('button', { name: /Убрать занятую дату/ }))
    expect(screen.getByLabelText('Занятые даты', { exact: true })).toHaveValue('')
    fireEvent.change(picker, { target: { value: '2027-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить дату' }))
    expect(screen.getByText(/Все занятые даты должны быть в диапазоне/)).toBeVisible()
  })

  it('keeps a duplicate application intact and shows the real receipt after successful retry', async () => {
    vi.spyOn(platformApi, 'apply')
      .mockRejectedValueOnce(new PlatformError('Такая анкета уже отправлена.', 409))
      .mockResolvedValueOnce({
        id: 'USR-test-receipt',
        status: 'pending',
        message: 'После одобрения она появится в подборе.',
      })
    render(<ApplicationPage options={mockOptions} error={null} onRetry={vi.fn()} />)
    fillApplication()
    submit()
    await screen.findByText('Такая анкета уже отправлена.')
    expect(screen.getByLabelText('Контактный email')).toHaveValue('anna@example.com')
    submit()
    await screen.findByRole('heading', { name: 'Анкета отправлена' })
    expect(screen.getByText('USR-test-receipt')).toBeVisible()
    expect(screen.getByText('На проверке', { exact: true })).toBeVisible()
    expect(document.querySelector('input[type=password]')).toBeNull()
  })

  it('aborts application submission when leaving the page', async () => {
    const send = vi.spyOn(platformApi, 'apply').mockReturnValue(new Promise(() => {}))
    const { unmount } = render(
      <ApplicationPage options={mockOptions} error={null} onRetry={vi.fn()} />,
    )
    fillApplication()
    submit()
    const signal = send.mock.calls[0][1]
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
