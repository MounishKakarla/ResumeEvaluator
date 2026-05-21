import pytest
from unittest.mock import patch, MagicMock
from app.services.segmenter import Section
from app.schemas import ScoringWeights
from app.services.scorer import score_resume

class DummySkill:
    def __init__(self, name, embedding=None):
        self.name = name
        self.embedding = embedding

@patch("app.services.scorer.get_confidence")
@patch("app.services.embedder.embedder")
def test_score_resume_weights_error(mock_embedder, mock_get_confidence):
    # Weights not summing to 100 should raise ValueError
    weights = ScoringWeights(projects=50, skills=30, education=10) # Sums to 90
    with pytest.raises(ValueError):
        score_resume(
            sections=[],
            required_skills=[],
            weights=weights,
            cosine_threshold=0.70
        )

@patch("app.services.scorer.get_confidence")
@patch("app.services.embedder.embedder")
def test_score_resume_logic(mock_embedder, mock_get_confidence):
    # Setup mocks
    mock_embedder.encode.return_value = "dummy_emb"
    
    # We will control the cosine similarity so it behaves predictably
    def mock_cosine(emb1, emb2):
        return 0.9  # Always strong match for this test

    mock_embedder.cosine_similarity.side_effect = mock_cosine
    
    # We control confidence
    def mock_conf(text, skill_name):
        if "built" in text.lower():
            return 1.0
        if "familiar" in text.lower():
            return 0.55
        return 0.75
    
    mock_get_confidence.side_effect = mock_conf

    sections = [
        Section(
            type="projects",
            title="Projects",
            start_line=1,
            end_line=3,
            text="I built a cool app using Python.",
            confidence=1.0,
            weight_multiplier=1.0
        ),
        Section(
            type="skills",
            title="Skills",
            start_line=5,
            end_line=6,
            text="Familiar with Java.",
            confidence=1.0,
            weight_multiplier=0.6
        )
    ]
    
    required_skills = [
        DummySkill(name="Python"),
        DummySkill(name="Java")
    ]
    
    weights = ScoringWeights(projects=50, skills=30, education=20)
    
    result = score_resume(
        sections=sections,
        required_skills=required_skills,
        weights=weights,
        cosine_threshold=0.70
    )
    
    # Python is in projects section.
    # combined score = 0.9 (cosine) * 1.0 (built conf) * 1.0 (project weight) = 0.9
    # normalised = 0.9 / 1.2 = 0.75
    
    # Java is in skills section.
    # combined score = 0.9 (cosine) * 0.55 (familiar conf) * 0.6 (skills weight) = 0.297
    # normalised = 0.297 / 1.2 = 0.2475
    # threshold is 0.70, so Java should be a skill gap!
    
    matched_names = [m.skill_name for m in result.skills_matched]
    assert "Python" in matched_names
    assert "Java" not in matched_names
    
    assert "Java" in result.skill_gaps

    # Check that top excerpt is assigned correctly
    assert result.top_excerpt == "I built a cool app using Python."
