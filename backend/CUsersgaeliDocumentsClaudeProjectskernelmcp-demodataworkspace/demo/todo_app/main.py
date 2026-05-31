from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

app = FastAPI(title="Todo List API", version="1.0.0")

# --- In-memory store ---
todos: dict = {}
_id_counter: int = 0


def next_id() -> int:
    global _id_counter
    _id_counter += 1
    return _id_counter


# --- Schemas ---
class TodoCreate(BaseModel):
    title: str
    description: Optional[str] = None
    completed: bool = False


class TodoUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    completed: Optional[bool] = None


class TodoResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    completed: bool
    created_at: str
    updated_at: str


# --- Routes ---
@app.get("/", tags=["Health"])
def root():
    return {"status": "ok", "message": "Todo API is running"}


@app.post("/todos", response_model=TodoResponse, status_code=201, tags=["Todos"])
def create_todo(payload: TodoCreate):
    todo_id = next_id()
    now = datetime.utcnow().isoformat()
    todo = {
        "id": todo_id,
        "title": payload.title,
        "description": payload.description,
        "completed": payload.completed,
        "created_at": now,
        "updated_at": now,
    }
    todos[todo_id] = todo
    return todo


@app.get("/todos", response_model=List[TodoResponse], tags=["Todos"])
def list_todos():
    return list(todos.values())


@app.get("/todos/{todo_id}", response_model=TodoResponse, tags=["Todos"])
def get_todo(todo_id: int):
    if todo_id not in todos:
        raise HTTPException(status_code=404, detail="Todo not found")
    return todos[todo_id]


@app.put("/todos/{todo_id}", response_model=TodoResponse, tags=["Todos"])
def update_todo(todo_id: int, payload: TodoUpdate):
    if todo_id not in todos:
        raise HTTPException(status_code=404, detail="Todo not found")
    todo = todos[todo_id]
    if payload.title is not None:
        todo["title"] = payload.title
    if payload.description is not None:
        todo["description"] = payload.description
    if payload.completed is not None:
        todo["completed"] = payload.completed
    todo["updated_at"] = datetime.utcnow().isoformat()
    return todo


@app.delete("/todos/{todo_id}", status_code=204, tags=["Todos"])
def delete_todo(todo_id: int):
    if todo_id not in todos:
        raise HTTPException(status_code=404, detail="Todo not found")
    del todos[todo_id]
