def fib(n: int) -> int:
    """Calculate the nth Fibonacci number using iterative approach.
    
    Args:
        n: The position in the Fibonacci sequence (0-indexed).
            fib(0) = 0, fib(1) = 1, fib(2) = 1, etc.
    
    Returns:
        The nth Fibonacci number.
    
    Examples:
        >>> fib(0)
        0
        >>> fib(1)
        1
        >>> fib(10)
        55
    """
    if n < 0:
        raise ValueError("n must be non-negative")
    if n == 0:
        return 0
    if n == 1:
        return 1
    
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b


def fib_recursive(n: int) -> int:
    """Calculate the nth Fibonacci number using naive recursion.
    
    Warning: This is O(2^n) and only suitable for small n.
    """
    if n < 0:
        raise ValueError("n must be non-negative")
    if n == 0:
        return 0
    if n == 1:
        return 1
    return fib_recursive(n - 1) + fib_recursive(n - 2)


def fib_memoized(n: int) -> int:
    """Calculate the nth Fibonacci number using memoization.
    
    Time complexity: O(n), Space complexity: O(n).
    """
    memo = {0: 0, 1: 1}
    
    def helper(k):
        if k not in memo:
            memo[k] = helper(k - 1) + helper(k - 2)
        return memo[k]
    
    return helper(n)


if __name__ == "__main__":
    # Quick test
    for i in range(20):
        print(f"fib({i}) = {fib(i)}")
