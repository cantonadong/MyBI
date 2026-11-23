test:
	cd backend && ../.venv/Scripts/python.exe -m pytest -q
	cd frontend && npm test -- --run
