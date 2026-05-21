from unittest.mock import patch
import pytest

from app.services.segmenter import detect_sections, _is_header_candidate

def test_is_header_candidate():
    assert _is_header_candidate("TECHNICAL SKILLS") == True
    assert _is_header_candidate("Projects:") == True
    assert _is_header_candidate("Education") == True
    
    # Not candidates
    assert _is_header_candidate("- bullet point") == False
    assert _is_header_candidate("• Another bullet") == False
    assert _is_header_candidate("This is a long sentence that ends with a period.") == False

def test_standard_headers():
    text = """
John Doe
TECHNICAL SKILLS
Python, FastAPI, React
Projects
Resume Evaluator
Education
University of Science
    """
    sections = detect_sections(text)
    
    # We expect 3 sections found
    assert len(sections) == 3
    
    assert sections[0].title == "TECHNICAL SKILLS"
    assert sections[0].type == "skills"
    assert sections[0].text == "Python, FastAPI, React"
    
    assert sections[1].title == "Projects"
    assert sections[1].type == "projects"
    assert sections[1].text == "Resume Evaluator"

    assert sections[2].title == "Education"
    assert sections[2].type == "education"
    assert sections[2].text == "University of Science"

def test_fuzzy_headers():
    text = """
Proyects
Built a system
Techncal Skills
Python, Java
    """
    sections = detect_sections(text)
    
    assert len(sections) == 2
    
    assert sections[0].type == "projects"
    assert sections[0].title == "Proyects"
    
    assert sections[1].type == "skills"
    assert sections[1].title == "Techncal Skills"

@patch("app.services.segmenter._embedding_classify")
def test_embedding_headers(mock_classify):
    # Mock the pass 4 classification
    mock_classify.side_effect = lambda line: "projects" if "What I've Built" in line else None
    
    text = """
What I've Built
A cool project
    """
    sections = detect_sections(text)
    
    assert len(sections) == 1
    assert sections[0].type == "projects"
    assert sections[0].title == "What I've Built"
    assert sections[0].text == "A cool project"

def test_bullets_ignored():
    text = """
Experience
Software Engineer
- TECHNICAL SKILLS
- Built cool things
    """
    sections = detect_sections(text)
    
    assert len(sections) == 1
    assert sections[0].type == "experience"
    
    # "- TECHNICAL SKILLS" should be part of the text, not a new section header
    assert "- TECHNICAL SKILLS" in sections[0].text
