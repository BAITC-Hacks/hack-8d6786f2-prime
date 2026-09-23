import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationPage, ContractorForm } from './PlatformPages'
import { platformApi, PlatformError } from './platform'
import { mockOptions } from './mocks/fixtures'

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
