import pytest
from fastapi.testclient import TestClient
from main import app, todos, _id_counter
import main

@pytest.fixture(autouse=True)
def reset_store():
    """Reset in-memory store before each test."""
    main.todos.clear()
    main._id_counter = 0
    yield
    main.todos.clear()
    main._id_counter = 0


client = TestClient(app)


# --- Health ---
def test_root():
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# --- CREATE ---
def test_create_todo():
    r = client.post("/todos", json={"title": "Buy milk", "description": "2% milk"})
    assert r.status_code == 201
    data = r.json()
    assert data["id"] == 1
    assert data["title"] == "Buy milk"
    assert data["description"] == "2% milk"
    assert data["completed"] is False


def test_create_todo_minimal():
    r = client.post("/todos", json={"title": "Minimal"})
    assert r.status_code == 201
    assert r.json()["description"] is None


def test_create_todo_missing_title():
    r = client.post("/todos", json={"description": "No title"})
    assert r.status_code == 422


# --- LIST ---
def test_list_todos_empty():
    r = client.get("/todos")
    assert r.status_code == 200
    assert r.json() == []


def test_list_todos():
    client.post("/todos", json={"title": "Task 1"})
    client.post("/todos", json={"title": "Task 2"})
    r = client.get("/todos")
    assert r.status_code == 200
    assert len(r.json()) == 2


# --- GET ---
def test_get_todo():
    client.post("/todos", json={"title": "Get me"})
    r = client.get("/todos/1")
    assert r.status_code == 200
    assert r.json()["title"] == "Get me"


def test_get_todo_not_found():
    r = client.get("/todos/999")
    assert r.status_code == 404
    assert r.json()["detail"] == "Todo not found"


# --- UPDATE ---
def test_update_todo():
    client.post("/todos", json={"title": "Old title"})
    r = client.put("/todos/1", json={"title": "New title", "completed": True})
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "New title"
    assert data["completed"] is True


def test_update_todo_partial():
    client.post("/todos", json={"title": "Partial", "description": "Keep me"})
    r = client.put("/todos/1", json={"completed": True})
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "Partial"
    assert data["description"] == "Keep me"
    assert data["completed"] is True


def test_update_todo_not_found():
    r = client.put("/todos/999", json={"title": "Ghost"})
    assert r.status_code == 404


# --- DELETE ---
def test_delete_todo():
    client.post("/todos", json={"title": "Delete me"})
    r = client.delete("/todos/1")
    assert r.status_code == 204
    # Confirm it's gone
    r2 = client.get("/todos/1")
    assert r2.status_code == 404


def test_delete_todo_not_found():
    r = client.delete("/todos/999")
    assert r.status_code == 404
