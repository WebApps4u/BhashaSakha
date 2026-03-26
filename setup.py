from setuptools import setup, find_packages

setup(
    name="bhashasakha",
    version="1.0.0",
    description="Offline Multilingual Voice Translation for Rural Banking",
    packages=find_packages(),
    python_requires=">=3.10",
    entry_points={
        "console_scripts": [
            "bhashasakha=src.main:main",
        ],
    },
)
