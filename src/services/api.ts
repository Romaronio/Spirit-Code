import type { Assignment } from "../types";
const BASE_URL = import.meta.env.VITE_API_URL as string | undefined

let mockAssignments: Assignment[] = [
  {
    id: '1',
    title: 'Фотосинтез',
    description: 'Прочитайте материал и ответьте, зачем растениям свет.',
    material: 'Фотосинтез — процесс, при котором растения превращают свет в энергию...',
    deadline: '2026-10-20',
    teacherId: 't1',
  },
  {
    id: '2',
    title: 'Теорема Пифагора',
    description: 'Решите три задачи на нахождение гипотенузы.',
    material: 'В прямоугольном треугольнике квадрат гипотенузы равен сумме квадратов катетов.',
    deadline: '2026-10-25',
    teacherId: 't1',
  },
]

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))