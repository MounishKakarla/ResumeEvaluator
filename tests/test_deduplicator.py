from app.services.deduplicator import compute_fingerprint, hamming_distance, is_duplicate

def test_same_text():
    text1 = "This is a standard resume text for software engineer."
    text2 = "This is a standard resume text for software engineer."
    
    fp1 = compute_fingerprint(text1)
    fp2 = compute_fingerprint(text2)
    
    assert hamming_distance(fp1, fp2) == 0
    assert is_duplicate(fp1, fp2)

def test_minor_changes():
    text1 = "This is a standard resume text for software engineer. I built a python app."
    text2 = "This is a standard resume text for a software developer. I built a python application."
    
    fp1 = compute_fingerprint(text1)
    fp2 = compute_fingerprint(text2)
    
    dist = hamming_distance(fp1, fp2)
    assert dist > 0
    # Expected to be similar enough
    assert is_duplicate(fp1, fp2, threshold=5)

def test_completely_different():
    text1 = "Software engineer with 5 years experience in React and Node.js."
    text2 = "Marketing manager skilled in SEO, campaign planning and social media."
    
    fp1 = compute_fingerprint(text1)
    fp2 = compute_fingerprint(text2)
    
    dist = hamming_distance(fp1, fp2)
    assert dist > 10
    assert not is_duplicate(fp1, fp2, threshold=3)
