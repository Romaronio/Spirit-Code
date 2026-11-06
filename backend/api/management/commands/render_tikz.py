from django.core.management.base import BaseCommand

from api.models import Assignment, Homework, TikzFigure
from api.tikz import queue_figures, render_pending


class Command(BaseCommand):
    help = 'Собирает рисунки TikZ всех заданий (нужно один раз для старых заданий и после смены шрифта)'

    def add_arguments(self, parser):
        parser.add_argument('--retry', action='store_true', help='собрать заново рисунки с ошибками')
        parser.add_argument('--all', action='store_true', help='собрать заново все рисунки')

    def handle(self, *args, **options):
        for obj in [*Assignment.objects.all(), *Homework.objects.all()]:
            queue_figures(obj)
        figures = TikzFigure.objects.all()
        if not options['all']:
            figures = figures.filter(status=TikzFigure.ERROR) if options['retry'] else figures.none()
        figures.update(status=TikzFigure.PENDING)
        render_pending()
        for status, label in TikzFigure.STATUSES:
            self.stdout.write(f'{label}: {TikzFigure.objects.filter(status=status).count()}')
